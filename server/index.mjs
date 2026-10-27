// Jeevan Rekha server.
//   /            landing page
//   /caller      browser phone: talk to the AI call-taker
//   /control     control room: live AI calls, rescue queue, map
//   /ws/call     caller audio in (24 kHz PCM16), agent turns out
//   /api/...     cases, assignment, surge simulation, event stream
import { EventEmitter } from 'node:events';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { CallSession } from '../lib/call-session.mjs';
import { gazetteer } from '../lib/gazetteer.mjs';
import { applyPhotoEvidence } from '../lib/intake.mjs';
import { modelsInUse } from '../lib/meta.mjs';
import { analysePhoto } from '../lib/photo.mjs';
import { CaseStore } from '../lib/store.mjs';
import { runSurge } from '../lib/surge.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const publicDir = join(import.meta.dirname, '..', 'public');
const store = new CaseStore(process.env.STORE_PATH ?? ':memory:');
const bus = new EventEmitter();
const sseClients = new Set();
const photos = new Map(); // caseId -> { mime, bytes } of the latest photo (demo: kept in memory)
let surgeRunning = false;
const stats = { callsAnswered: 0, merged: 0 };
bus.on('call', (e) => {
  if (e.type === 'started') stats.callsAnswered++;
  if (e.type === 'merged') stats.merged++;
});
const snapshot = () => ({ kind: 'snapshot', cases: store.list(), stats });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const PAGES = { '/': 'index.html', '/caller': 'caller.html', '/control': 'control.html' };

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(data);
}
store.on('change', (e) => broadcast({ kind: 'case', ...e }));
bus.on('call', (e) => broadcast({ kind: 'call', ...e }));
bus.on('surge', (e) => broadcast({ kind: 'surge', ...e }));
// Waiting time feeds priority, so re-rank the queue periodically.
setInterval(() => broadcast(snapshot()), 15000).unref();

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (url.pathname === '/api/config') {
    const districts = Object.entries(gazetteer).map(([key, d]) => ({ key, name: d.places.find((p) => p.kind === 'district').name, state: d.state, center: d.center }));
    return json(res, 200, { districts, models: modelsInUse() });
  }
  if (url.pathname === '/api/cases' && req.method === 'GET') {
    return json(res, 200, store.list({ includeClosed: url.searchParams.has('all') }));
  }
  const action = url.pathname.match(/^\/api\/cases\/(JR-\d+)\/(assign|rescued|reopen)$/);
  if (action && req.method === 'POST') {
    const [, id, verb] = action;
    if (!store.get(id)) return json(res, 404, { error: 'no such case' });
    const body = await readJson(req);
    const patch =
      verb === 'assign' ? { status: 'assigned', assignedTeam: body.team || 'Boat team' } :
      verb === 'rescued' ? { status: 'rescued' } : { status: 'open', assignedTeam: null };
    return json(res, 200, store.update(id, patch, verb));
  }
  const photo = url.pathname.match(/^\/api\/cases\/(JR-\d+)\/photo$/);
  if (photo && req.method === 'GET') {
    const p = photos.get(photo[1]);
    if (!p) return json(res, 404, { error: 'no photo' });
    res.writeHead(200, { 'Content-Type': p.mime });
    return res.end(p.bytes);
  }
  if (photo && req.method === 'POST') {
    const id = photo[1];
    if (!store.get(id)) return json(res, 404, { error: 'no such case' });
    const { dataUrl } = await readJson(req);
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl ?? '');
    if (!m) return json(res, 400, { error: 'expected a JPEG, PNG or WebP data URL' });
    photos.set(id, { mime: m[1], bytes: Buffer.from(m[2], 'base64') });
    const evidence = await analysePhoto(dataUrl);
    const updated = applyPhotoEvidence(store, id, evidence);
    return json(res, 200, { case: updated, evidence });
  }
  if (url.pathname === '/api/surge' && req.method === 'POST') {
    if (surgeRunning) return json(res, 409, { error: 'surge already running' });
    surgeRunning = true;
    runSurge({ store, bus })
      .catch((err) => bus.emit('surge', { type: 'surge-error', message: err.message }))
      .finally(() => (surgeRunning = false));
    return json(res, 202, { started: true });
  }
  if (url.pathname === '/api/reset' && req.method === 'POST') {
    store.reset();
    photos.clear();
    Object.assign(stats, { callsAnswered: 0, merged: 0 });
    broadcast(snapshot());
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: 'not found' });
}

function serveStatic(res, pathname) {
  const file = normalize(join(publicDir, PAGES[pathname] ?? pathname));
  if (!file.startsWith(publicDir) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

// Optional passcode for public deployments, so strangers can't spend the Meta API credits.
// Visiting any page with ?code=<passcode> sets a cookie; everything else then requires it.
const PASSCODE = process.env.DEMO_PASSCODE;
const hasAccess = (req, url) =>
  !PASSCODE || url.searchParams.get('code') === PASSCODE || (req.headers.cookie ?? '').split(/;\s*/).includes(`jr_access=${PASSCODE}`);

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!hasAccess(req, url)) {
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<p style="font-family:sans-serif;padding:24px">Jeevan Rekha demo: open the link with <code>?code=&lt;passcode&gt;</code>.</p>');
  }
  if (PASSCODE && url.searchParams.get('code') === PASSCODE) {
    res.setHeader('Set-Cookie', `jr_access=${PASSCODE}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  }
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => json(res, 500, { error: err.message }));
  } else {
    serveStatic(res, url.pathname);
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws/call' || !hasAccess(req, url)) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    const send = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
    const session = new CallSession({
      store,
      bus,
      send,
      lang: url.searchParams.get('lang') ?? 'hi-IN',
      district: url.searchParams.get('district') || undefined,
      callerNumber: url.searchParams.get('caller') ?? '',
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return session.audio(data);
      const msg = JSON.parse(data.toString());
      if (msg.type === 'hangup') ws.close();
    });
    ws.on('close', () => session.end());
  });
});

if (!process.env.MODEL_API_KEY) {
  console.error('MODEL_API_KEY is not set. Copy .env.example to .env and run with: npm start');
  process.exit(1);
}
server.listen(PORT, () => console.log(`Jeevan Rekha on http://localhost:${PORT}  (caller: /caller, control room: /control)`));

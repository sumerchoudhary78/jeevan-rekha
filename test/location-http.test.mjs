import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import WebSocket from 'ws';

async function app(t) {
  const child = spawn(process.execPath, ['--import', './test/fixtures/location-provider.mjs', 'server/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '0', STORE_PATH: ':memory:', LOCATION_TEST_SEED: '0', MODEL_API_KEY: 'test-meta-key',
      ELEVENLABS_API_KEY: '', DEMO_PASSCODE: 'test-access' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Test server did not start')), 5000);
    child.on('error', reject);
    child.on('exit', () => { clearTimeout(timer); reject(new Error('Test server exited')); });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/call?code=test-access&lang=en-IN`);
  t.after(() => ws.terminate());
  const messages = [];
  const notifications = new Set();
  ws.on('message', (bytes) => {
    messages.push(JSON.parse(bytes.toString()));
    for (const notify of notifications) notify();
  });
  const waitFor = (predicate) => new Promise((resolve, reject) => {
    const check = () => {
      const message = messages.find(predicate);
      if (message) { clearTimeout(timer); notifications.delete(check); resolve(message); }
    };
    const timer = setTimeout(() => { notifications.delete(check); reject(new Error('Expected WebSocket event was not received')); }, 5000);
    notifications.add(check);
    check();
  });
  await once(ws, 'open');
  return {
    ws, waitFor, messages,
    cases: () => fetch(`http://127.0.0.1:${port}/api/cases`, { headers: { Cookie: 'jr_access=test-access' } }).then((r) => r.json()),
  };
}

test('caller coordinates travel over the real WebSocket into the case and map snapshot', async (t) => {
  const client = await app(t);
  const fix = { lat: 25.611, lon: 85.14, accuracy: 18 };
  client.ws.send(JSON.stringify({ type: 'location', position: fix }));
  await client.waitFor((m) => m.type === 'location');
  client.ws.send(Buffer.from('TEST:Four people near the water tower.'));
  const response = await client.waitFor((m) => m.type === 'agent' && m.record);
  assert.equal(response.caseLocation.source, 'device');
  assert.equal(response.caseLocation.lat, fix.lat);
  const [c] = await client.cases();
  assert.equal(c.id, response.caseId);
  assert.equal(c.locationAccuracy, 18);
  assert.equal(c.lat, fix.lat);
  assert.deepEqual(c.reports[0].deviceLocation, fix);

  client.ws.send(JSON.stringify({ type: 'location', position: { ...fix, lat: 999 } }));
  await client.waitFor((m) => m.type === 'error' && m.code === 'location');
  client.ws.send('{');
  await client.waitFor((m) => m.type === 'error' && m.message === 'Invalid call message.');
  assert.equal((await client.cases())[0].lat, fix.lat);
});

test('a caller without a device fix can still open a case at their reported rescue location', async (t) => {
  const client = await app(t);
  client.ws.send(Buffer.from('TEST:We are in Bahera, Darbhanga, by the school.'));
  const response = await client.waitFor((m) => m.type === 'agent' && m.record);
  const [c] = await client.cases();
  assert.equal(c.id, response.caseId);
  assert.equal(c.locationSource, 'reported');
  assert.equal(c.place, 'Bahera');
  assert.notEqual(c.lat, null);
});

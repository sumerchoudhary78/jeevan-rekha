// End-to-end test of the live call path without a microphone: synthesizes each caller
// line with macOS `say`, streams it to /ws/call at real-time pace (silence in between,
// as a phone line would), and waits for the agent's reply before speaking again.
//   node scripts/fake-caller.mjs [ws://localhost:8787] [district|any] [board]
// "board" plays a caller from a group already reported on the flood night (run the
// simulation first): the agent should ask whether they are that group and join the case.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const base = process.argv[2] ?? 'ws://localhost:8787';
const district = process.argv[3] === 'any' ? '' : (process.argv[3] ?? 'darbhanga');
const code = process.env.DEMO_PASSCODE ? `&code=${encodeURIComponent(process.env.DEMO_PASSCODE)}` : '';
const lines = process.argv[4] === 'board' ? [
  'हैलो, हम बहेड़ा गांव में फंसे हैं, शिव मंदिर के पीछे वाले घर में',
  'हां, मेरे भाई ने पहले फोन किया था, हम वही लोग हैं',
  'अब पानी छत तक आ गया है, बाकी सब वैसा ही है',
  'ठीक है, धन्यवाद',
] : [
  'हैलो, हम दरभंगा के बहेड़ा गांव में फंसे हैं, पानी बहुत बढ़ गया है',
  'शिव मंदिर के पीछे वाला घर है',
  'हम तीस लोग हैं छत पर',
  'हां, तीस, सही है। एक बूढ़ी अम्मा हैं जो चल नहीं सकतीं, और दो छोटे बच्चे',
  'पानी पहली मंज़िल की खिड़की तक है',
  'ठीक है, धन्यवाद',
];

const FRAME = 24000 * 2 * 0.08; // 80 ms of 24 kHz PCM16
const dir = mkdtempSync(join(tmpdir(), 'jr-caller-'));
const clips = lines.map((text, i) => {
  const aiff = join(dir, `${i}.aiff`);
  const wav = join(dir, `${i}.wav`);
  execFileSync('say', ['-v', 'Lekha', '-o', aiff, text]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', aiff, '-ar', '24000', '-ac', '1', '-sample_fmt', 's16', wav]);
  return readFileSync(wav).subarray(44);
});

const ws = new WebSocket(`${base}/ws/call?lang=hi-IN&district=${district}&caller=%2B91-90000-00001${code}`);
let queue = Buffer.alloc(0);
let agentTurns = 0;
let done = false;
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'agent') {
    console.log(`${stamp()} AGENT : ${msg.text}${msg.caseId ? `  [${msg.caseId}]` : ''}`);
    const next = clips[agentTurns++];
    if (msg.complete || !next) done = true;
    else queue = Buffer.concat([queue, next, Buffer.alloc(FRAME * 12)]);
  } else if (msg.type === 'caller') console.log(`${stamp()} HEARD : ${msg.text}`);
  else if (msg.type === 'merged') console.log(`${stamp()} MERGED into ${msg.caseId}: ${msg.reason}`);
  else if (msg.type === 'opened') console.log(`${stamp()} OPENED ${msg.caseId}${msg.possibleDuplicateOf ? ` (possible duplicate of ${msg.possibleDuplicateOf})` : ''}`);
  else if (msg.type === 'error') console.log(`${stamp()} ERROR : ${msg.message}`);
});

await new Promise((resolve) => ws.once('open', resolve));
// Pace audio in real time; send silence when the caller isn't speaking.
while (!done && Date.now() - t0 < 180000) {
  const frame = queue.length ? queue.subarray(0, FRAME) : Buffer.alloc(FRAME);
  queue = queue.subarray(frame.length);
  ws.send(frame);
  await sleep(80);
}
await sleep(1500);
const res = await fetch(`${base.replace('ws', 'http')}/api/cases?${code.slice(1)}`);
const cases = await res.json();
for (const c of cases) {
  console.log(`\nCASE ${c.id} ${c.urgency} priority=${c.priority} people=${c.headcountMin}-${c.headcountMax} confirmed=${c.headcountConfirmed}`);
  console.log(`  ${c.place} (${c.area} / ${c.landmark} / ${c.district}) @ ${c.lat},${c.lon}  vulnerable=${c.vulnerable} water=${c.waterLevel} callback=${c.callback}`);
}
ws.close();

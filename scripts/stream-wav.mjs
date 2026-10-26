// Streams a 24 kHz mono 16-bit WAV through the realtime transcriber at real-time pace.
//   node --env-file=.env scripts/stream-wav.mjs day1/audio/clean/01-hi-bahera.wav
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { RealtimeTranscriber } from '../lib/asr-realtime.mjs';

const wav = readFileSync(process.argv[2]);
const pcm = wav.subarray(44);
const FRAME = 24000 * 2 * 0.08;

const asr = new RealtimeTranscriber({ languageBias: ['Hindi', 'English'] });
asr.on('ready', (e) => console.log('ready', e.sessionId));
asr.on('turn', (t) => console.log('TURN', t.turnId, t.text));
asr.on('error', (e) => console.error('ERROR', e.message));
asr.on('close', (c) => console.log('closed', c.code, c.reason));

for (let i = 0; i < pcm.length; i += FRAME) {
  asr.write(pcm.subarray(i, i + FRAME));
  await sleep(80);
}
// trailing silence so endpointing can close the last turn
for (let i = 0; i < 15; i++) {
  asr.write(Buffer.alloc(FRAME));
  await sleep(80);
}
asr.end();

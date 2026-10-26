// Synthesizes the surge calls as phone-quality WAVs (8 kHz band-limited + background noise, 24 kHz container).
//   node scripts/gen-surge-audio.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const surgeDir = join(import.meta.dirname, '..', 'data', 'surge');
const audioDir = join(surgeDir, 'audio');
mkdirSync(audioDir, { recursive: true });
const { calls } = JSON.parse(readFileSync(join(surgeDir, 'calls.json'), 'utf8'));

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

for (const call of calls) {
  const aiff = join(audioDir, `${call.id}.aiff`);
  execFileSync('say', ['-v', call.voice, '-r', '190', '-o', aiff, call.text]);
  ffmpeg(
    '-i', aiff,
    '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.05:sample_rate=24000',
    '-filter_complex',
    '[0:a]aresample=24000,highpass=f=300,lowpass=f=3400,aresample=8000,aresample=24000[v];' +
      '[v][1:a]amix=inputs=2:duration=first:normalize=0[out]',
    '-map', '[out]', '-ac', '1', '-sample_fmt', 's16', join(audioDir, `${call.id}.wav`),
  );
  rmSync(aiff);
  console.log(`generated ${call.id} (${call.voice})`);
}

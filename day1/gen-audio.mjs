// Synthesizes the day-1 distress calls with macOS `say` and converts them for the ASR endpoint.
//   clean: 24 kHz mono 16-bit WAV (the model's native rate)
//   noisy: phone-band (300-3400 Hz, 8 kHz) plus pink background noise, resampled back to 24 kHz
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const { cases } = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'));
const cleanDir = join(here, 'audio', 'clean');
const noisyDir = join(here, 'audio', 'noisy');
mkdirSync(cleanDir, { recursive: true });
mkdirSync(noisyDir, { recursive: true });

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

for (const c of cases) {
  const aiff = join(cleanDir, `${c.id}.aiff`);
  const clean = join(cleanDir, `${c.id}.wav`);
  const noisy = join(noisyDir, `${c.id}.wav`);

  execFileSync('say', ['-v', c.voice, '-o', aiff, c.text]);
  ffmpeg('-i', aiff, '-ar', '24000', '-ac', '1', '-sample_fmt', 's16', clean);
  rmSync(aiff);

  ffmpeg(
    '-i', clean,
    '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.06:sample_rate=24000',
    '-filter_complex',
    '[0:a]highpass=f=300,lowpass=f=3400,aresample=8000,aresample=24000[voice];' +
      '[voice][1:a]amix=inputs=2:duration=first:normalize=0[out]',
    '-map', '[out]', '-ac', '1', '-sample_fmt', 's16', noisy,
  );
  console.log(`generated ${c.id}`);
}
console.log(`\nclean: ${cleanDir}\nnoisy: ${noisyDir}`);

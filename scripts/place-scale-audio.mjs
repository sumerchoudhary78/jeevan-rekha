// Builds the held-out place test: 30 Darbhanga census villages that the demo gazetteer does
// not know, drawn at random with a fixed seed, each spoken as a short distress call in Hindi
// and in English (macOS `say`), put through the day-1 phone-band + noise filter, and
// transcribed by Muse Voice Transcribe twice:
//   demo  - with today's keyword list for the district (the demo gazetteer's names)
//   scale - with a district-scale list: demo names, block names, then villages by population,
//           up to the API's limit of 500 keywords
// Writes data/place-scale/calls.json (audio stays in data/place-scale/audio, not committed).
// Hindi spellings of the census names come from one Muse Spark call; they only drive the
// synthetic speech. The answer key is the census name.
//   node --env-file=.env scripts/place-scale-audio.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keywordsFor, norm } from '../lib/gazetteer.mjs';
import { chatJson, transcribe } from '../lib/meta.mjs';

const root = join(import.meta.dirname, '..');
const outDir = join(root, 'data', 'place-scale');
const audioDir = join(outDir, 'audio');
mkdirSync(audioDir, { recursive: true });

const SAMPLE = 30;
const KEYWORD_LIMIT = 500; // Muse Voice Transcribe rejects longer lists; keywords are at most 30 characters
const full = JSON.parse(readFileSync(join(root, 'data', 'gazetteer-full', 'darbhanga.json'), 'utf8')).places;
const compact = (s) => norm(s).replace(/ /g, '');
const demoKeywords = keywordsFor(['darbhanga']);
const known = new Set(full.filter((p) => p.source === 'curated').flatMap((p) => [p.name, ...p.aliases]).map(compact));

// mulberry32: a small seeded PRNG, so the sample is reproducible.
let seed = 20261028;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pool = full.filter((p) => p.kind === 'village' && p.source === 'census' && !known.has(compact(p.name)));
const villages = [];
while (villages.length < SAMPLE) {
  const v = pool.splice(Math.floor(random() * pool.length), 1)[0];
  villages.push({ name: v.name, block: v.block, population: v.population });
}

const byPopulation = full.filter((p) => p.kind === 'village').sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
const scaleKeywords = [
  ...new Set([...demoKeywords, ...full.filter((p) => p.kind === 'block').map((p) => p.name), ...byPopulation.map((p) => p.name)]),
]
  .filter((k) => k.length <= 30)
  .slice(0, KEYWORD_LIMIT);
const inScaleKeywords = new Set(scaleKeywords.map(compact));

const { data } = await chatJson({
  system: 'You transliterate Indian village names from Roman script into Devanagari, as a Hindi speaker from Bihar would write them.',
  user: `Village names in Darbhanga district, Bihar:\n${villages.map((v) => v.name).join('\n')}`,
  schemaName: 'Transliterations',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      names: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, properties: { roman: { type: 'string' }, devanagari: { type: 'string' } }, required: ['roman', 'devanagari'] },
      },
    },
    required: ['names'],
  },
});
const devanagari = Object.fromEntries(data.names.map((n) => [compact(n.roman), n.devanagari]));

const LINES = {
  hi: [
    (v) => `हैलो, हम दरभंगा के ${v} गांव में फंसे हैं, पानी तेजी से बढ़ रहा है।`,
    (v) => `${v} गांव से बोल रहे हैं, दरभंगा जिला, घर में पानी घुस गया है, जल्दी नाव भेजिए।`,
    (v) => `हैलो, मैं ${v} से बोल रहा हूँ, हम छत पर हैं, पानी बहुत ऊपर है।`,
  ],
  en: [
    (v) => `Hello, we are trapped in ${v} village in Darbhanga district, the water is rising fast.`,
    (v) => `I am calling from ${v} village, Darbhanga. Water has entered the house, please send a boat.`,
    (v) => `Please help, we are on the roof in ${v}, the water is very high.`,
  ],
};
const VOICE = { hi: 'Lekha', en: 'Rishi' };
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

const calls = [];
for (const [i, v] of villages.entries()) {
  for (const lang of ['hi', 'en']) {
    const spoken = lang === 'hi' ? (devanagari[compact(v.name)] ?? v.name) : v.name;
    const text = LINES[lang][i % 3](spoken);
    const id = `${String(i + 1).padStart(2, '0')}-${lang}-${compact(v.name)}`;
    const aiff = join(audioDir, `${id}.aiff`);
    const clean = join(audioDir, `${id}.clean.wav`);
    const noisy = join(audioDir, `${id}.wav`);
    execFileSync('say', ['-v', VOICE[lang], '-o', aiff, text]);
    ffmpeg('-i', aiff, '-ar', '24000', '-ac', '1', '-sample_fmt', 's16', clean);
    ffmpeg(
      '-i', clean,
      '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.06:sample_rate=24000',
      '-filter_complex',
      '[0:a]highpass=f=300,lowpass=f=3400,aresample=8000,aresample=24000[voice];[voice][1:a]amix=inputs=2:duration=first:normalize=0[out]',
      '-map', '[out]', '-ac', '1', '-sample_fmt', 's16', noisy,
    );
    rmSync(aiff);
    rmSync(clean);
    const languageBias = lang === 'hi' ? ['Hindi', 'English'] : ['English', 'Hindi'];
    const demo = (await transcribe(noisy, { languageBias, keywords: demoKeywords })).text;
    const scale = (await transcribe(noisy, { languageBias, keywords: scaleKeywords })).text;
    calls.push({ id, village: v.name, block: v.block, lang, spoken: text, inScaleKeywords: inScaleKeywords.has(compact(v.name)), transcripts: { demo, scale } });
    console.log(`${id.padEnd(28)} demo: ${demo.slice(0, 60)}\n${''.padEnd(28)} scale: ${scale.slice(0, 60)}`);
  }
}

writeFileSync(
  join(outDir, 'calls.json'),
  JSON.stringify(
    {
      _comment:
        'Held-out place test (scripts/place-scale-audio.mjs): census villages unknown to the demo gazetteer, synthetic phone-band calls, ' +
        `Muse Voice Transcribe with the demo keyword list (${demoKeywords.length}) and a district-scale list (${scaleKeywords.length}).`,
      keywords: { demo: demoKeywords.length, scale: scaleKeywords.length },
      calls,
    },
    null,
    1,
  ),
);
console.log(`\nwrote ${calls.length} calls to data/place-scale/calls.json`);

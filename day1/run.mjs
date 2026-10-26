// Day-1 go/no-go test: can Muse Voice Transcribe + Muse Spark turn a distress call
// into a dispatchable record (location, headcount, urgency)?
//
//   node --env-file=.env day1/run.mjs [--set clean|noisy|<dir>] [--only <case-id>] [--no-compare]
//
// Each clip is transcribed twice, with and without gazetteer keyword biasing, so the
// effect of biasing is measured rather than assumed. Pass bar: >= 8/10 cases correct
// on location + headcount + urgency in the biased run.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { transcribe } from '../lib/meta.mjs';
import { extractDistressCall } from '../lib/extract.mjs';

const PASS_BAR = 8;
const here = import.meta.dirname;

const { values: args } = parseArgs({
  options: {
    set: { type: 'string', default: 'clean' },
    only: { type: 'string' },
    'no-compare': { type: 'boolean', default: false },
  },
});

const { gazetteers, cases } = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'));
const audioDir = isAbsolute(args.set) ? args.set : join(here, 'audio', args.set);
const selected = cases.filter((c) => !args.only || c.id === args.only);
const variants = args['no-compare'] ? ['biased'] : ['biased', 'unbiased'];

const norm = (s) =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const mentions = (haystack, variants) => variants.some((v) => norm(haystack).includes(norm(v)));

function score(expected, got) {
  const where = `${got.location.area} ${got.location.landmark} ${got.location.district}`;
  const area = mentions(where, expected.area);
  const landmark = expected.landmark.length === 0 || mentions(where, expected.landmark);

  const [lo, hi] = expected.headcount;
  const { min, max } = got.headcount;
  const headcount = lo === hi ? min === lo && max === hi : min > 0 && min <= hi && max >= lo;

  const urgency = got.urgency === expected.urgency;
  const vulnerableFound = expected.vulnerable.filter((v) => got.vulnerable.includes(v)).length;

  return {
    location: area && landmark,
    area,
    landmark,
    headcount,
    urgency,
    vulnerable: `${vulnerableFound}/${expected.vulnerable.length}`,
    pass: area && landmark && headcount && urgency,
  };
}

const mark = (ok) => (ok ? 'ok' : 'XX');
const results = [];

for (const c of selected) {
  const wav = join(audioDir, `${c.id}.wav`);
  if (!existsSync(wav)) {
    console.log(`skip ${c.id}: ${wav} not found`);
    continue;
  }

  for (const variant of variants) {
    const keywords = variant === 'biased' ? gazetteers[c.gazetteer] : undefined;
    const started = Date.now();
    try {
      const asr = await transcribe(wav, { languageBias: c.languageBias, keywords });
      const { model, data } = await extractDistressCall(asr.text);
      const s = score(c.expected, data);
      results.push({ id: c.id, variant, model, ms: Date.now() - started, transcript: asr.text, extracted: data, score: s });
      console.log(
        `${c.id.padEnd(28)} ${variant.padEnd(8)} loc ${mark(s.location)}  count ${mark(s.headcount)}  ` +
          `urgency ${mark(s.urgency)} (${data.urgency})  vuln ${s.vulnerable}  ${s.pass ? 'PASS' : 'FAIL'}`,
      );
      if (!s.pass) {
        console.log(`    heard:     ${asr.text}`);
        console.log(`    extracted: ${JSON.stringify({ ...data.location, headcount: data.headcount, urgency: data.urgency })}`);
      }
    } catch (err) {
      results.push({ id: c.id, variant, error: err.message });
      console.log(`${c.id.padEnd(28)} ${variant.padEnd(8)} ERROR ${err.message}`);
    }
  }
}

console.log('\n=== summary ===');
for (const variant of variants) {
  const runs = results.filter((r) => r.variant === variant);
  const passed = runs.filter((r) => r.score?.pass).length;
  const field = (f) => runs.filter((r) => r.score?.[f]).length;
  console.log(
    `${variant.padEnd(8)} pass ${passed}/${runs.length}  location ${field('location')}  ` +
      `headcount ${field('headcount')}  urgency ${field('urgency')}`,
  );
}

const biased = results.filter((r) => r.variant === 'biased');
const biasedPassed = biased.filter((r) => r.score?.pass).length;
if (biased.length === cases.length) {
  console.log(biasedPassed >= PASS_BAR ? `\nGO: ${biasedPassed}/${cases.length} >= ${PASS_BAR}` : `\nNO-GO: ${biasedPassed}/${cases.length} < ${PASS_BAR}`);
}

const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${args.only ?? 'all'}.json`);
writeFileSync(outFile, JSON.stringify({ set: args.set, results }, null, 2));
console.log(`results: ${outFile}`);

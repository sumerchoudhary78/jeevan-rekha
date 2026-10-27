// Scores place-name resolution on real ASR output (every transcript saved by the day-1 runs,
// clean and noisy, biased and unbiased) plus lines naming places that are not in the gazetteer.
//   node scripts/place-eval.mjs
// No API calls: it replays saved transcripts.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLocation, suggestPlaces } from '../lib/gazetteer.mjs';

const root = join(import.meta.dirname, '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

// Gazetteer places that count as the right answer for each day-1 call.
const EXPECTED = {
  '01-hi-bahera': ['Bahera'],
  '02-hi-basantpur': ['Bhimnagar', 'Basantpur'],
  '03-hi-aurai': ['Aurai'],
  '04-hi-laheriasarai': ['Laheriasarai'],
  '05-hi-runnisaidpur': ['Runnisaidpur'],
  '06-hinglish-kankarbagh': ['Kankarbagh'],
  '07-hinglish-rajendranagar': ['Rajendra Nagar'],
  '08-hinglish-danapur-panic': ['Danapur Diara', 'Danapur'],
  '09-ta-velachery': ['Velachery', 'Vijayanagar'],
  '10-te-singhnagar': ['Singh Nagar', 'Dabha Gardens'],
};
const districtOf = Object.fromEntries(read('day1/cases.json').cases.map((c) => [c.id, c.gazetteer]));

// Unique (call, transcript) pairs across all saved runs.
const seen = new Set();
const positives = [];
for (const f of readdirSync(join(root, 'day1/results')).filter((f) => f.endsWith('.json'))) {
  for (const r of read(`day1/results/${f}`).results) {
    if (!EXPECTED[r.id] || !/\p{L}/u.test(r.transcript ?? "") || seen.has(r.transcript)) continue;
    seen.add(r.transcript);
    positives.push({ id: r.id, district: districtOf[r.id], text: r.transcript, area: r.extracted?.location?.area ?? '' });
  }
}
const negatives = read('data/place-eval/negatives.json').lines;

// Old behaviour: whatever resolveLocation finds in the text is taken as the place, no confidence level.
const legacy = (text, district) => {
  const { place, districtKey } = resolveLocation({ area: text });
  return place && (!district || districtKey === district) ? { level: 'likely', place } : { level: 'none', place: null };
};
const current = (text, district) => {
  const s = suggestPlaces(text, district ? [district] : undefined);
  return { level: s.level, place: s.candidates[0]?.place ?? null };
};

function score(name, resolver, field, scoped) {
  const pos = { right: 0, ask: 0, wrong: 0, none: 0 };
  const misses = [];
  for (const p of positives) {
    const r = resolver(p[field], scoped ? p.district : null);
    const ok = EXPECTED[p.id].includes(r.place);
    if (r.level === 'none') pos.none++;
    else if (!ok) pos.wrong++;
    else if (r.level === 'exact') pos.right++;
    else pos.ask++;
    if (r.level === 'none' || !ok) misses.push(`${p.id}: ${r.level} ${r.place ?? '-'} <- ${p[field].slice(0, 90)}`);
  }
  const neg = { none: 0, ask: 0, wrongExact: 0 };
  for (const n of negatives) {
    const r = resolver(n.text, scoped ? n.district : null);
    if (r.level === 'none') neg.none++;
    else if (r.level === 'exact') neg.wrongExact++;
    else neg.ask++;
    if (r.level !== 'none') misses.push(`NEG ${r.level} ${r.place} <- ${n.text}`);
  }
  const found = pos.right + pos.ask;
  console.log(
    `${name.padEnd(34)} found ${String(found).padStart(2)}/${positives.length} (exact ${pos.right}, confirm ${pos.ask})  ` +
      `wrong ${pos.wrong}  missed ${pos.none}  | not-in-gazetteer: rejected ${neg.none}/${negatives.length}, ` +
      `confirm-asked ${neg.ask}, wrong-exact ${neg.wrongExact}`,
  );
  return misses;
}

console.log(`${positives.length} unique real transcripts, ${negatives.length} negative lines\n`);
const show = process.argv.includes('--misses');
for (const [name, fn] of [['before (resolveLocation)', legacy], ['after (suggestPlaces)', current]]) {
  for (const [label, field, scoped] of [
    ['transcript, district known', 'text', true],
    ['transcript, any district', 'text', false],
    ['extracted area, district known', 'area', true],
  ]) {
    const misses = score(`${name}: ${label}`, fn, field, scoped);
    if (show && misses.length) console.log(misses.map((m) => `    ${m}`).join('\n'));
  }
  console.log();
}

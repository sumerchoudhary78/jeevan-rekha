// Scores place-name resolution on real ASR output (every transcript saved by the day-1 runs,
// clean and noisy, biased and unbiased) plus lines naming places that are not in the gazetteer.
//   node scripts/place-eval.mjs [--misses] [--refresh]
// No API calls: it replays the transcripts kept in data/place-eval/transcripts.json
// (--refresh rebuilds that file from day1/results after new day-1 runs).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyPlaces, MIN_LIKELY, resolveLocation, scorePlaces, suggestPlaces } from '../lib/gazetteer.mjs';

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
const TRANSCRIPTS = 'data/place-eval/transcripts.json';

// Unique (call, transcript) pairs across all saved day-1 runs.
if (process.argv.includes('--refresh') || !existsSync(join(root, TRANSCRIPTS))) {
  const districtOf = Object.fromEntries(read('day1/cases.json').cases.map((c) => [c.id, c.gazetteer]));
  const seen = new Set();
  const transcripts = [];
  for (const f of readdirSync(join(root, 'day1/results')).filter((f) => f.endsWith('.json')).sort()) {
    for (const r of read(`day1/results/${f}`).results) {
      if (!EXPECTED[r.id] || !/\p{L}/u.test(r.transcript ?? '') || seen.has(r.transcript)) continue;
      seen.add(r.transcript);
      transcripts.push({ id: r.id, district: districtOf[r.id], text: r.transcript, area: r.extracted?.location?.area ?? '' });
    }
  }
  const body = transcripts.map((t) => `  ${JSON.stringify(t)}`).join(',\n');
  writeFileSync(join(root, TRANSCRIPTS), `{\n "_comment": "Unique transcripts from every day-1 run (clean and noisy audio, with and without keyword biasing), with the area the extractor read from each.",\n "transcripts": [\n${body}\n ]\n}\n`);
}
const positives = read(TRANSCRIPTS).transcripts;
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

// Held-out check of the threshold, since MIN_LIKELY was chosen on this same data: leave one
// call out. For each of the 10 calls, pick the threshold on the other nine calls' transcripts
// (and the negatives outside its fold) with a rule fixed before running, then score the
// held-out call and its fold of negatives at that threshold.
//   rule: maximise found - 10 x wrong place - 10 x negatives placed exactly - 1 x negatives asked
//         about; ties go to the higher (more cautious) threshold
const THRESHOLDS = Array.from({ length: 29 }, (_, i) => +(0.7 + i * 0.01).toFixed(2));
const pos = positives.map((p) => ({ ...p, scored: scorePlaces(p.text, [p.district], { floor: 0.5 }) }));
const neg = negatives.map((n, i) => ({ ...n, fold: i % 10, scored: scorePlaces(n.text, [n.district], { floor: 0.5 }) }));
const calls = Object.keys(EXPECTED);

function tally(posSet, negSet, minLikely) {
  const t = { found: 0, wrong: 0, missed: 0, negNone: 0, negAsked: 0, negExact: 0 };
  for (const p of posSet) {
    const r = classifyPlaces(p.scored, { minLikely });
    if (r.level === 'none') t.missed++;
    else if (EXPECTED[p.id].includes(r.candidates[0].place)) t.found++;
    else t.wrong++;
  }
  for (const n of negSet) {
    const r = classifyPlaces(n.scored, { minLikely });
    t[r.level === 'none' ? 'negNone' : r.level === 'exact' ? 'negExact' : 'negAsked']++;
  }
  return t;
}
const objective = (t) => t.found - 10 * t.wrong - 10 * t.negExact - t.negAsked;

const held = { found: 0, wrong: 0, missed: 0, negNone: 0, negAsked: 0, negExact: 0 };
const picked = [];
for (const [k, call] of calls.entries()) {
  const tunePos = pos.filter((p) => p.id !== call);
  const tuneNeg = neg.filter((n) => n.fold !== k);
  let best = null;
  for (const th of THRESHOLDS) {
    const value = objective(tally(tunePos, tuneNeg, th));
    if (!best || value >= best.value) best = { th, value };
  }
  picked.push(best.th);
  const t = tally(pos.filter((p) => p.id === call), neg.filter((n) => n.fold === k), best.th);
  for (const key of Object.keys(held)) held[key] += t[key];
}
const inSample = tally(pos, neg, MIN_LIKELY);
console.log('Threshold, leave one call out (transcript, district known):');
console.log(`  thresholds picked per fold: ${picked.join(' ')} (shipped: ${MIN_LIKELY})`);
console.log(
  `  held out: found ${held.found}/${pos.length}, wrong ${held.wrong}, missed ${held.missed} | negatives rejected ${held.negNone}/${neg.length}, ` +
    `asked ${held.negAsked}, wrong-exact ${held.negExact}`,
);
console.log(
  `  in sample at ${MIN_LIKELY}: found ${inSample.found}/${pos.length}, wrong ${inSample.wrong}, missed ${inSample.missed} | ` +
    `negatives rejected ${inSample.negNone}/${neg.length}, asked ${inSample.negAsked}, wrong-exact ${inSample.negExact}`,
);

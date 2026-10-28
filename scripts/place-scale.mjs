// Place matching at district scale. The demo gazetteer knows 7 places in Darbhanga; the
// district has 1,069 census villages in 18 blocks (data/gazetteer-full/darbhanga.json).
// Both tests use the shipped threshold and make no API calls:
//   1. replay: the real Darbhanga transcripts and the Darbhanga lines of the negatives file,
//      against the demo gazetteer and against the full list
//   2. held out: fresh calls from 30 census villages the demo gazetteer does not know
//      (scripts/place-scale-audio.mjs), transcribed with the demo keyword list and with a
//      district-scale one (the API takes at most 500 keywords)
//   node scripts/place-scale.mjs [--misses]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gazetteer, norm, suggestPlaces } from '../lib/gazetteer.mjs';

const root = join(import.meta.dirname, '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const compact = (s) => norm(s).replace(/ /g, '');
const show = process.argv.includes('--misses');

const LISTS = {
  demo: { label: 'demo gazetteer (7 places)', places: undefined },
  full: { label: 'district scale (1,126 places)', places: { darbhanga: read('data/gazetteer-full/darbhanga.json').places } },
};
const inList = (list, names) =>
  (list.places?.darbhanga ?? gazetteer.darbhanga.places).some((p) => names.some((n) => compact(n) === compact(p.name)));

// What the call-taker would do with one line, given the names of the place it really names
// ([] when the place is not in the list or the line names none).
//   exact / confirm / askWhich  right place: no question, one yes/no question, "A or B?"
//   wrongAsked                  asks about a wrong place: the caller says no, one wasted question
//   wrongExact                  a wrong place taken without a question: the dangerous error
//   missed / rejected           nothing matched: asks for a landmark (rejected is right when the place is unknown)
function outcome(text, names, list) {
  const r = suggestPlaces(text, ['darbhanga'], { places: list.places });
  const right = (c) => names.some((n) => compact(n) === compact(c.place));
  let o;
  if (r.level === 'none') o = names.length ? 'missed' : 'rejected';
  else if (r.level === 'ambiguous' && r.candidates.some(right)) o = 'askWhich';
  else if (right(r.candidates[0])) o = r.level === 'exact' ? 'exact' : 'confirm';
  else o = r.level === 'exact' ? 'wrongExact' : 'wrongAsked';
  return { o, got: r.candidates.map((c) => `${c.place}${c.block ? ` (${c.block})` : ''}`).join(' | ') || '-', level: r.level };
}

const OUTCOMES = ['exact', 'confirm', 'askWhich', 'wrongAsked', 'wrongExact', 'missed', 'rejected'];
function report(title, items, list) {
  const t = Object.fromEntries(OUTCOMES.map((k) => [k, 0]));
  const misses = [];
  for (const it of items) {
    const names = inList(list, it.names) ? it.names : [];
    const { o, got } = outcome(it.text, names, list);
    t[o]++;
    if (!['exact', 'confirm', 'askWhich', 'rejected'].includes(o)) misses.push(`${o.padEnd(10)} ${got.padEnd(34)} <- ${it.text.slice(0, 80)}`);
  }
  const right = t.exact + t.confirm + t.askWhich;
  console.log(
    `  ${title.padEnd(44)} n=${String(items.length).padStart(3)}  right ${String(right).padStart(3)} (exact ${t.exact}, confirm ${t.confirm}, which-of-two ${t.askWhich})` +
      `  wrong: asked ${t.wrongAsked}, taken ${t.wrongExact}  missed ${t.missed}  rejected ${t.rejected}`,
  );
  if (show) misses.forEach((m) => console.log(`      ${m}`));
  return t;
}

// 1. Replay
const EXPECTED = { '01-hi-bahera': ['Bahera'], '04-hi-laheriasarai': ['Laheriasarai'] };
const replay = read('data/place-eval/transcripts.json')
  .transcripts.filter((t) => EXPECTED[t.id])
  .map((t) => ({ text: t.text, names: EXPECTED[t.id] }));
const negatives = read('data/place-eval/negatives.json').lines.filter((l) => l.district === 'darbhanga');
console.log(`Replay: ${replay.length} real Darbhanga transcripts, ${negatives.length} Darbhanga lines naming places outside the demo gazetteer`);
for (const list of Object.values(LISTS)) {
  console.log(` ${list.label}`);
  report('real transcripts (Bahera, Laheriasarai)', replay, list);
  const named = negatives.filter((l) => inList(list, l.names));
  if (named.length) report(`lines whose place is in this list (${named.map((l) => l.names[0]).join(', ')})`.slice(0, 44), named, list);
  report('lines whose place is not in this list', negatives.filter((l) => !inList(list, l.names)), list);
}

// 2. Held out
const heldOutFile = 'data/place-scale/calls.json';
if (existsSync(join(root, heldOutFile))) {
  const { calls, keywords } = read(heldOutFile);
  const villages = new Set(calls.map((c) => c.village)).size;
  console.log(`\nHeld out: ${calls.length} calls from ${villages} census villages unknown to the demo gazetteer (Hindi and English, phone-band noise)`);
  const set = (kw, filter = () => true) => calls.filter(filter).map((c) => ({ text: c.transcripts[kw], names: [c.village] }));
  console.log(` today: demo keywords (${keywords.demo}) + demo gazetteer; the right answer is "not a known place"`);
  report('all calls', set('demo'), LISTS.demo);
  console.log(` district scale gazetteer, demo keywords (${keywords.demo})`);
  report('all calls', set('demo'), LISTS.full);
  console.log(` district scale gazetteer, district keywords (${keywords.scale}: demo names, blocks, villages by population)`);
  report('all calls', set('scale'), LISTS.full);
  report('village in the keyword list', set('scale', (c) => c.inScaleKeywords), LISTS.full);
  report('village not in the keyword list', set('scale', (c) => !c.inScaleKeywords), LISTS.full);
  report('Hindi calls', set('scale', (c) => c.lang === 'hi'), LISTS.full);
  report('English calls', set('scale', (c) => c.lang === 'en'), LISTS.full);
}

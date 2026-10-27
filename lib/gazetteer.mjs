import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const gazetteer = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'gazetteer.json'), 'utf8'));

// Lowercases and drops accents from Latin text ("Bihār" -> "bihar"). Combining marks in
// Indic scripts are vowel signs, not accents, so they are kept (and kept out of the separator class).
export const norm = (s = '') =>
  s
    .normalize('NFKD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();

const compact = (s) => norm(s).replace(/ /g, '');

// Keyword-biasing list for Muse Voice Transcribe: every place name, alias and landmark.
export function keywordsFor(districtKeys = Object.keys(gazetteer)) {
  const words = new Set();
  for (const key of districtKeys) {
    const d = gazetteer[key];
    if (!d) continue;
    for (const p of d.places) [p.name, ...p.aliases].forEach((w) => words.add(w));
    d.landmarks.forEach((w) => words.add(w));
  }
  return [...words];
}

export function languageBiasFor(districtKey) {
  return gazetteer[districtKey]?.languageBias;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

// True when the text names the place: the alias appears verbatim, or some run of 1-3
// words is a near spelling of it (ASR and transliteration drift: Hayghat ~ Hayaghat).
// A truncated fragment ("Bahad") must not match a longer name ("Bahadurpur").
function placeMatch(place, text) {
  const words = norm(text).split(' ').filter(Boolean);
  if (!words.length) return 0;
  const spans = [];
  for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= words.length; i++) spans.push(words.slice(i, i + n).join(''));
  const whole = words.join('');
  let best = 0;
  for (const alias of [place.name, ...place.aliases]) {
    const a = compact(alias);
    if (a.length < 4) continue;
    const near = spans.some((s) => Math.abs(s.length - a.length) <= 2 && 1 - editDistance(s, a) / Math.max(s.length, a.length) >= 0.8);
    if (whole.includes(a) || near) best = Math.max(best, a.length);
  }
  return best; // length of the longest matching name, so "Danapur Diara" beats "Danapur"
}

const placeMatches = (place, text) => placeMatch(place, text) > 0;

// Resolves an extracted location to a district and map coordinates.
// Prefers the most specific place (village/locality) over the district itself.
export function resolveLocation({ area = '', landmark = '', district = '' }) {
  const text = `${area} ${landmark}`;
  const candidates = Object.entries(gazetteer).filter(
    ([, d]) => !district || d.places.some((p) => p.kind === 'district' && placeMatches(p, district)),
  );
  const pools = candidates.length ? candidates : Object.entries(gazetteer);

  let best = null;
  for (const [key, d] of pools) {
    for (const p of d.places) {
      if (p.kind === 'district') continue;
      const score = Math.max(placeMatch(p, area) + 0.5, placeMatch(p, text)); // the area field outranks the landmark
      if (score > 0.5 && (!best || score > best.score)) best = { score, key, p };
    }
  }
  if (best) {
    const { key, p } = best;
    return { districtKey: key, place: p.name, lat: p.lat, lon: p.lon, approximate: p.approximate };
  }
  if (candidates.length) {
    const [key, d] = candidates[0];
    return { districtKey: key, place: null, lat: d.center.lat, lon: d.center.lon, approximate: true };
  }
  return { districtKey: null, place: null, lat: null, lon: null, approximate: true };
}

// Sound key for matching names across spellings and scripts. Consonants are folded into
// classes (aspirated = plain, retroflex = dental, sh = s, w = v); vowels are dropped
// except at the start of a word, because ASR and transliteration disagree on them most.
// "Kankarbagh", "कंकड़बाग" and the misheard "Tankarbagh" become knkrbg / knkrbg / tnkrbg.
const DEVANAGARI = {
  क: 'k', ख: 'k', ग: 'g', घ: 'g', ङ: 'n', च: 'c', छ: 'c', ज: 'j', झ: 'j', ञ: 'n',
  ट: 't', ठ: 't', ड: 'd', ढ: 'd', ण: 'n', त: 't', थ: 't', द: 'd', ध: 'd', न: 'n',
  प: 'p', फ: 'p', ब: 'b', भ: 'b', म: 'm', य: '', र: 'r', ल: 'l', व: 'v',
  श: 's', ष: 's', स: 's', ह: 'h', 'ं': 'n',
};
const NUKTA = { ड: 'r', ढ: 'r', फ: 'p', ज: 'j', क: 'k', ख: 'k', ग: 'g' };

function wordKey(word) {
  const w = word.normalize('NFD');
  if (/\p{Script=Devanagari}/u.test(w)) {
    let key = /^[ऄ-औ]/.test(w) ? 'V' : '';
    for (let i = 0; i < w.length; i++) {
      if (w[i + 1] === '़') key += NUKTA[w[i]] ?? DEVANAGARI[w[i]] ?? '';
      else key += DEVANAGARI[w[i]] ?? '';
    }
    return key.replace(/(.)\1+/g, '$1');
  }
  if (!/^[a-z]/.test(w)) return ''; // other Indic scripts: matched by spelling only
  const s = w
    .replace(/c?ch/g, 'c').replace(/sh/g, 's').replace(/ph/g, 'p')
    .replace(/([kgjtdb])h/g, '$1')
    .replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/f/g, 'p').replace(/y/g, '');
  return ((/^[aeiou]/.test(s) ? 'V' : '') + s.replace(/[aeiou]/g, '')).replace(/(.)\1+/g, '$1');
}

// Edit distance where near-sounding consonants cost half (r/d flap, v/b, n/m, s/c, j/y).
const NEAR = new Set(['rd', 'dr', 'vb', 'bv', 'nm', 'mn', 'sc', 'cs', 'lr', 'rl']);
function soundDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      const sub = a[i - 1] === b[j - 1] ? 0 : NEAR.has(a[i - 1] + b[j - 1]) ? 0.5 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + sub);
      prev = cur;
    }
  }
  return row[b.length];
}

// How strongly a run of 1-3 words in the text sounds like the alias (0..1).
// Short keys must match exactly: three consonants leave no room for error.
function soundMatch(aliasKey, spanKeys) {
  if (aliasKey.length < 3) return 0;
  let best = 0;
  for (const k of spanKeys) {
    if (Math.abs(k.length - aliasKey.length) > 1) continue;
    if (aliasKey.length <= 4 && k !== aliasKey) continue;
    best = Math.max(best, 1 - soundDistance(k, aliasKey) / Math.max(k.length, aliasKey.length));
  }
  return best;
}

// Devanagari with vowel signs, nukta and nasal marks removed: "औराई" and the misheard "औरई"
// both become "औरई". Independent vowels stay, so "और" ("and") does not collapse into it.
const skeleton = (s) => s.normalize('NFD').replace(/[\u0900-\u0903\u093A-\u094F\u0962\u0963]/g, '');

function skeletonMatch(alias, spans) {
  const a = skeleton(compact(alias));
  if (!/\p{Script=Devanagari}/u.test(a) || a.length < 3) return 0;
  let best = 0;
  for (const s of spans) {
    if (Math.abs(s.length - a.length) > 1) continue;
    if (a.length === 3 && s !== a) continue;
    best = Math.max(best, 1 - editDistance(s, a) / Math.max(s.length, a.length));
  }
  return best;
}

const MIN_LIKELY = 0.84;
const MIN_MARGIN = 0.1;

// Ranks gazetteer places the text may be naming, with a confidence level:
//   exact     - a known name or alias appears as spelt, no need to ask
//   likely    - one place clearly sounds closest; confirm it by name with the caller
//   ambiguous - two places sound about as close; ask which one
//   none      - nothing close; ask for a landmark instead of guessing
export function suggestPlaces(text, districtKeys = Object.keys(gazetteer)) {
  const words = norm(text).split(' ').filter(Boolean);
  const keys = words.map(wordKey);
  const spanKeys = [];
  const skeletons = [];
  const spans = [];
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= keys.length; i++) {
      spans.push(words.slice(i, i + n).join(''));
      spanKeys.push(keys.slice(i, i + n).join(''));
      skeletons.push(skeleton(words.slice(i, i + n).join('')));
    }
  }

  const scored = [];
  for (const key of districtKeys) {
    const d = gazetteer[key];
    if (!d) continue;
    for (const p of d.places) {
      if (p.kind === 'district') continue;
      const spelt = placeMatch(p, text);
      const sound = Math.max(
        ...[p.name, ...p.aliases].map((a) => Math.max(soundMatch(norm(a).split(' ').map(wordKey).join(''), spanKeys), skeletonMatch(a, skeletons))),
      );
      const exact = [p.name, ...p.aliases].some((a) => compact(a).length >= 4 && spans.includes(compact(a)));
      const score = exact ? 1 + spelt / 100 : Math.max(spelt ? 0.85 : 0, sound);
      const native = p.aliases.find((a) => !/\p{Script=Latin}/u.test(a));
      if (score >= MIN_LIKELY) scored.push({ place: p.name, native, district: key, lat: p.lat, lon: p.lon, score: +score.toFixed(2), exact });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const [top, second] = scored;
  let level = 'none';
  if (top?.exact) level = 'exact';
  else if (top) level = second && top.score - second.score < MIN_MARGIN ? 'ambiguous' : 'likely';
  return { level, candidates: scored.slice(0, level === 'ambiguous' ? 2 : 1) };
}

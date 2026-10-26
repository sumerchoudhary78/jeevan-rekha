import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const gazetteer = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'gazetteer.json'), 'utf8'));

export const norm = (s = '') =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

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

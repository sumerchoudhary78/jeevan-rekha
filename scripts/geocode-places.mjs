// One-off: resolves data/places.source.json to coordinates with OpenStreetMap Nominatim
// (1 request/second per its usage policy) and writes data/gazetteer.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const dataDir = join(import.meta.dirname, '..', 'data');
const source = JSON.parse(readFileSync(join(dataDir, 'places.source.json'), 'utf8'));

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'jeevan-rekha-hackathon/0.1 (github.com/sumerchoudhary78)' } });
  await sleep(1100);
  if (!res.ok) return null;
  const [hit] = await res.json();
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
}

const out = {};
for (const [key, district] of Object.entries(source)) {
  const districtName = district.places.find((p) => p.kind === 'district').name;
  const center = await geocode(`${districtName}, ${district.state}`);
  const places = [];
  for (const place of district.places) {
    let coords =
      place.kind === 'district' ? center : await geocode(`${place.name}, ${place.near ?? districtName}, ${district.state}`);
    let approximate = false;
    if (!coords) {
      // Unresolved: fall back to the district centre, flagged so the map says so.
      coords = center;
      approximate = true;
    }
    places.push({ ...place, ...coords, approximate });
    console.log(`${key.padEnd(12)} ${place.name.padEnd(20)} ${coords ? `${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}` : 'MISSING'}${approximate ? ' (approx)' : ''}`);
  }
  out[key] = { state: district.state, languageBias: district.languageBias, center, places, landmarks: district.landmarks };
}

writeFileSync(join(dataDir, 'gazetteer.json'), JSON.stringify(out, null, 2));
console.log('wrote data/gazetteer.json');

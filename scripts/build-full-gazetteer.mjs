// One-off: builds a district-scale gazetteer for Darbhanga, to measure place matching at
// real scale (the demo gazetteer has 7 places there). Sources:
//   - Census of India 2011 village directory, per block, via census2011.co.in
//   - OpenStreetMap place nodes inside the district boundary (Overpass), for coordinates
//     and town localities
// Writes data/gazetteer-full/darbhanga.json, and the raw downloads to
// data/gazetteer-full/sources/ so --offline can rebuild without fetching. Names are Latin
// script only.
//   node scripts/build-full-gazetteer.mjs [--offline]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { gazetteer, norm } from '../lib/gazetteer.mjs';

const UA = 'jeevan-rekha-hackathon/0.1 (github.com/sumerchoudhary78)';
const CENSUS = 'https://www.census2011.co.in';
const DISTRICT_PAGE = '/data/district/67-darbhanga-bihar.html';
const OSM_AREA = 3600000000 + 1568263; // Darbhanga district boundary relation

const outDir = join(import.meta.dirname, '..', 'data', 'gazetteer-full');
const sourcesDir = join(outDir, 'sources');
mkdirSync(sourcesDir, { recursive: true });
const offline = process.argv.includes('--offline');

const get = async (url, init) => {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...init?.headers } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
};
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
const compact = (s) => norm(s).replace(/ /g, '');

// Census: the district page links one page per block; each block page lists its villages.
async function censusVillages() {
  const districtHtml = await (await get(CENSUS + DISTRICT_PAGE)).text();
  const blockPages = [...new Set(districtHtml.match(/\/data\/subdistrict\/[^"]+-darbhanga-bihar\.html/g))];
  const villages = [];
  for (const page of blockPages) {
    const html = await (await get(CENSUS + page)).text();
    for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
      if (cells.length !== 4 || !/^\d+$/.test(cells[0]) || cells[2] === 'Bihar') continue; // "Bihar" rows are towns
      const [, name, block, population] = cells;
      villages.push({ name, block, population: Number(population.replace(/,/g, '')) || 0 });
    }
    await sleep(1500);
  }
  return villages;
}

// OpenStreetMap place nodes, for coordinates of villages with a unique name and for localities.
async function osmNodes() {
  const query = `[out:json][timeout:240];area(${OSM_AREA})->.a;node["place"~"^(village|hamlet|town|suburb|neighbourhood|locality|city)$"]["name"](area.a);out body;`;
  // Public Overpass servers are often overloaded (502/504): retry, alternating mirrors.
  const hosts = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await get(hosts[attempt % hosts.length], { method: 'POST', body: new URLSearchParams({ data: query }) });
      return (await res.json()).elements.map(({ id, lat, lon, tags }) => ({ id, lat, lon, tags }));
    } catch (err) {
      if (attempt === 5) throw err;
      console.log(`${err.message}, retrying`);
      await sleep(20000);
    }
  }
}

const readSource = (name) => JSON.parse(readFileSync(join(sourcesDir, name), 'utf8'));
const villages = offline ? readSource('census-villages.json') : await censusVillages();
const osm = offline ? readSource('osm-nodes.json') : await osmNodes();
if (!offline) {
  writeFileSync(join(sourcesDir, 'census-villages.json'), `[\n${villages.map((v) => JSON.stringify(v)).join(',\n')}\n]\n`);
  writeFileSync(join(sourcesDir, 'osm-nodes.json'), `[\n${osm.map((n) => JSON.stringify(n)).join(',\n')}\n]\n`);
}

const curated = gazetteer.darbhanga.places;
const curatedNames = new Set(curated.flatMap((p) => [p.name, ...p.aliases]).map(compact));
const blocks = new Set(villages.map((v) => v.block));
const byName = new Map();
for (const v of villages) byName.set(compact(v.name), [...(byName.get(compact(v.name)) ?? []), v]);

const places = curated.filter((p) => p.kind !== 'district').map((p) => ({ ...p, source: 'curated' }));
// A block shares its name with its headquarters village; the village entry stands for both,
// so two entries with the same name are always two different places.
for (const b of blocks) {
  const hq = villages.some((v) => v.block === b && compact(v.name) === compact(b));
  if (!hq && !curatedNames.has(compact(b))) places.push({ name: b, aliases: [], kind: 'block', block: b, source: 'census' });
}
for (const v of villages) {
  const nodes = osm.filter((n) => compact(n.tags.name) === compact(v.name));
  const coords = byName.get(compact(v.name)).length === 1 && nodes.length === 1 ? { lat: nodes[0].lat, lon: nodes[0].lon } : {};
  places.push({ name: v.name, aliases: [], kind: 'village', block: v.block, population: v.population, ...coords, source: 'census' });
}
for (const n of osm) {
  const key = compact(n.tags.name);
  if (curatedNames.has(key) || byName.has(key) || blocks.has(n.tags.name) || n.tags.place === 'city') continue;
  const aliases = [n.tags['name:hi'], n.tags['name:en']].filter((a) => a && compact(a) !== key);
  places.push({ name: n.tags.name, aliases, kind: n.tags.place, lat: n.lat, lon: n.lon, source: 'osm' });
}

const out = {
  _source:
    'Census of India 2011 village directory (via census2011.co.in), OpenStreetMap contributors (ODbL), and the curated demo gazetteer. ' +
    'Built by scripts/build-full-gazetteer.mjs for the district-scale place-matching test; not used by the live demo.',
  district: 'darbhanga',
  places,
};
writeFileSync(join(outDir, 'darbhanga.json'), `${JSON.stringify(out, null, 1)}\n`);
const shared = [...byName.values()].filter((vs) => vs.length > 1);
console.log(
  `${blocks.size} blocks, ${villages.length} census villages (${byName.size} distinct names; ` +
    `${shared.reduce((n, vs) => n + vs.length, 0)} villages share a name), ${osm.length} OSM nodes -> ${places.length} places`,
);
const clash = villages.filter((v) => curatedNames.has(compact(v.name)));
if (clash.length) console.log(`census villages named like a curated place: ${clash.map((v) => `${v.name} (${v.block})`).join(', ')}`);

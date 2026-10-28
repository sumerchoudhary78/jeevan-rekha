import { WATER_LEVEL } from './extract.mjs';
import { norm, resolveLocation, suggestPlaces } from './gazetteer.mjs';
import { chatJson } from './meta.mjs';
import { higherUrgency } from './store.mjs';

const DUPLICATE_RADIUS_KM = 1.5;

function distanceKm(a, b) {
  if (a.lat == null || b.lat == null) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const deeperWater = (a, b) => {
  const rank = (w) => (w === 'unknown' ? -1 : WATER_LEVEL.indexOf(w));
  return rank(a) >= rank(b) ? a : b;
};

// Cases close enough that they might be the same people calling twice
// (or two neighbours reporting the same rooftop).
function duplicateCandidates(store, incoming) {
  return store.list().filter(
    (c) =>
      c.id !== incoming.id &&
      c.districtKey &&
      c.districtKey === incoming.districtKey &&
      // An unplaced report (garbled village name) is compared with the whole district.
      (!incoming.place ||
        !c.place ||
        c.place === incoming.place ||
        distanceKm(c, incoming) <= DUPLICATE_RADIUS_KM ||
        (norm(c.area) && norm(c.area) === norm(incoming.area))),
  );
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    relation: { type: 'string', enum: ['same_group', 'same_pickup_point', 'possible_duplicate', 'different'] },
    case_id: { type: 'string', description: 'The open case it relates to, or empty string when different' },
    reason: { type: 'string' },
  },
  required: ['relation', 'case_id', 'reason'],
};

const describe = (c) =>
  `${c.id}: area="${c.area}" landmark="${c.landmark}" district="${c.district}" people=${c.headcountMin}-${c.headcountMax} ` +
  `vulnerable=[${c.vulnerable.join(', ')}] water=${c.waterLevel} | ${c.summary}`;

async function judgeDuplicate(store, incoming) {
  const candidates = duplicateCandidates(store, incoming);
  if (!candidates.length) return null;
  const { data } = await chatJson({
    system:
      'You triage distress reports for a flood rescue control room and decide how a new report relates to nearby open cases.\n' +
      '- same_group: the same people at the same spot (a relative or neighbour calling about the same rooftop counts).\n' +
      '- same_pickup_point: same building or exact spot (same landmark, same roof) but it may be a different group of people there. One boat run serves both.\n' +
      '- possible_duplicate: plausibly the same incident but a key detail (landmark, house, count) conflicts or was garbled on a bad line. A human will check.\n' +
      '- different: a different house, landmark or group.\n' +
      'Transcripts come from noisy phone lines, so spellings drift. A wrong merge can leave people behind; when in real doubt prefer possible_duplicate.',
    user: `New report:\n${describe(incoming)}\n\nOpen cases nearby:\n${candidates.map(describe).join('\n')}`,
    schemaName: 'DuplicateJudgement',
    schema: JUDGE_SCHEMA,
    reasoningEffort: 'low',
  });
  const target = candidates.find((c) => c.id === data.case_id);
  return target && data.relation !== 'different' ? { target, relation: data.relation, reason: data.reason } : null;
}

// Folds a report's facts into an existing case without ever lowering urgency or headcount.
// For a shared pickup point the groups may be different people, so the upper bound adds up:
// the boat is sized for the worst case.
function mergedFields(target, incoming, relation = 'same_group') {
  return {
    headcountMin: Math.max(target.headcountMin, incoming.headcountMin),
    headcountMax:
      relation === 'same_pickup_point'
        ? target.headcountMax + incoming.headcountMax
        : Math.max(target.headcountMax, incoming.headcountMax),
    headcountConfirmed: target.headcountConfirmed || incoming.headcountConfirmed,
    vulnerable: [...new Set([...target.vulnerable, ...incoming.vulnerable])],
    waterLevel: deeperWater(target.waterLevel, incoming.waterLevel),
    urgency: higherUrgency(target.urgency, incoming.urgency),
    landmark: target.landmark || incoming.landmark,
    callback: [...new Set([target.callback, incoming.callback].filter(Boolean))].join(', '),
    reports: [...target.reports, ...incoming.reports],
    summary: target.summary,
    missingInfo: incoming.missingInfo?.length ? incoming.missingInfo : target.missingInfo,
  };
}

const WATER_AT_LEAST_CRITICAL = ['chest_or_window', 'neck_or_above', 'roof'];

// Folds photo evidence (SAM 3.1 person count + Muse Spark scene read) into a case.
// People visible in the photo are a floor on the headcount; nothing is ever lowered.
export function applyPhotoEvidence(store, caseId, { people, scene }) {
  const c = store.get(caseId);
  const counted = Math.max(people.count, scene.people_visible);
  const waterLevel = deeperWater(c.waterLevel, scene.water_level);
  return store.update(
    caseId,
    {
      headcountMin: Math.max(c.headcountMin, counted),
      headcountMax: Math.max(c.headcountMax, counted),
      vulnerable: [...new Set([...c.vulnerable, ...scene.vulnerable_visible])],
      waterLevel,
      urgency: WATER_AT_LEAST_CRITICAL.includes(waterLevel) ? 'critical' : c.urgency,
      photoCount: (c.photoCount ?? 0) + 1,
      photoEvidence: { at: Date.now(), samCount: people.count, boxes: people.boxes, scene, caseId }, // caseId: where the image is stored
    },
    'photo',
  );
}

// Maps the extractor's / agent's snake_case record onto case columns.
// When spelling finds no place inside the known district, fall back to the sound match
// ("Bahad" -> Bahera). Nobody confirmed it, so the case stays marked approximate.
function resolveWithSound(location, lineDistrict) {
  const resolved = resolveLocation(location, { lineDistrict });
  if (resolved.place || !resolved.districtKey) return resolved;
  const { level, candidates } = suggestPlaces(`${location.area} ${location.landmark}`, [resolved.districtKey]);
  if (level !== 'likely' && level !== 'exact') return resolved;
  const [c] = candidates;
  return { districtKey: c.district, place: c.place, lat: c.lat, lon: c.lon, approximate: true };
}

// `lineDistrict` is the district helpline the call came in on, if known.
export function caseFieldsFrom(extracted, { lineDistrict } = {}) {
  const location = {
    area: extracted.location?.area ?? '',
    landmark: extracted.location?.landmark ?? '',
    district: extracted.location?.district ?? '',
  };
  return {
    ...location,
    ...resolveWithSound(location, lineDistrict),
    headcountMin: extracted.headcount?.min ?? 0,
    headcountMax: extracted.headcount?.max ?? 0,
    headcountConfirmed: !!extracted.headcount_confirmed,
    vulnerable: [...new Set(extracted.vulnerable ?? [])],
    waterLevel: extracted.water_level ?? 'unknown',
    urgency: extracted.urgency ?? 'low',
    summary: extracted.summary_en ?? '',
    missingInfo: extracted.missing_info ?? [],
  };
}

// Reports are recorded one at a time: two calls about the same rooftop arriving together
// must not both see "no duplicate" and open two cases.
let recording = Promise.resolve();
function serially(fn) {
  const result = recording.then(fn);
  recording = result.catch(() => {});
  return result;
}

// Records a report. Either opens a new case or merges into an existing one.
// Returns { case, merged, reason }. A live caller can be asked whether they are a group
// already reported, so live calls pass judge: false and open their own case; the call
// links it to an existing one only if the caller says yes (see CaseBoard).
export function recordReport(store, fields, report, { judge = true } = {}) {
  if (!judge) return serially(() => ({ case: store.create({ ...fields, reports: [report] }), merged: false }));
  return serially(() => recordReportNow(store, fields, report));
}

const phoneKeys = (callback) =>
  (callback ?? '')
    .split(',')
    .map((p) => p.replace(/\D/g, '').slice(-10))
    .filter((p) => p.length >= 6);

// Open cases that may be the caller's own group: reported from the same phone, or at the
// same place (same gazetteer place, within the duplicate radius, or the same area name).
// Same phone first, then same place, then nearby; oldest first within each.
export function relatedOpenCases(store, incoming, { exclude = [] } = {}) {
  const phones = phoneKeys(incoming.callback);
  const rank = (c) => {
    if (phoneKeys(c.callback).some((p) => phones.includes(p))) return 0;
    if (!c.districtKey || c.districtKey !== incoming.districtKey) return null;
    if (incoming.place && c.place === incoming.place) return 1;
    if (incoming.place && c.place && distanceKm(c, incoming) <= DUPLICATE_RADIUS_KM) return 2;
    if (norm(c.area) && norm(c.area) === norm(incoming.area)) return 3;
    return null;
  };
  return store
    .list()
    .filter((c) => !exclude.includes(c.id))
    .map((c) => ({ c, rank: rank(c) }))
    .filter((x) => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.c.createdAt - b.c.createdAt)
    .map((x) => x.c);
}

// The caller confirmed they are part of a group already reported: fold this call's own case
// (or, if none is open yet, its report) into that case. Like every merge, it only raises
// urgency and headcount.
export function joinCase(store, { ownCaseId, targetId, fields, report }) {
  return serially(() => {
    if (ownCaseId === targetId) return store.get(targetId);
    const own = ownCaseId ? store.get(ownCaseId) : null;
    const incoming = confirmedCountOnly(own ?? { ...fields, reports: [report] });
    const target = store.get(targetId);
    const photo = target.photoEvidence ? {} : { photoEvidence: own?.photoEvidence ?? null, photoCount: own?.photoCount ?? 0 };
    const updated = store.update(targetId, { ...mergedFields(target, incoming, 'same_group'), ...photo }, 'merged');
    if (own) store.update(own.id, { status: 'merged', mergedInto: targetId, possibleDuplicateOf: null });
    return updated;
  });
}

async function recordReportNow(store, fields, report) {
  const incoming = { ...fields, reports: [report] };
  const verdict = await judgeDuplicate(store, incoming);
  if (verdict && verdict.relation !== 'possible_duplicate') {
    const updated = store.update(verdict.target.id, mergedFields(verdict.target, incoming, verdict.relation), 'merged');
    return { case: updated, merged: true, relation: verdict.relation, reason: verdict.reason };
  }
  const possibleDuplicateOf = verdict?.target.id ?? null;
  return { case: store.create({ ...incoming, possibleDuplicateOf }), merged: false, possibleDuplicateOf, reason: verdict?.reason };
}

// A live caller's headcount joins a shared case only once it has been read back and
// confirmed: merges never lower a count, so a misheard 60 (for 6) could not be corrected.
// People counted in the caller's photo still count.
function confirmedCountOnly(fields) {
  if (fields.headcountConfirmed) return fields;
  const seen = fields.photoEvidence ? Math.max(fields.photoEvidence.samCount, fields.photoEvidence.scene.people_visible) : 0;
  return { ...fields, headcountMin: seen, headcountMax: seen };
}

// Live-call updates: refresh what this caller told us. Values from the caller's own
// latest turn replace earlier ones; nothing from other reports is lowered.
export function updateFromCall(store, caseId, fields) {
  const current = store.get(caseId);
  if (current.reports.length <= 1) {
    return store.update(caseId, { ...fields, summary: fields.summary || current.summary });
  }
  // Shared case: keep its established location, only fold in new facts.
  return store.update(caseId, mergedFields(current, { ...confirmedCountOnly(fields), reports: [] }));
}

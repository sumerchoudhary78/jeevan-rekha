// Unit tests for the deterministic parts: place resolution, priority, merging, photo evidence.
//   npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { keywordsFor, resolveLocation, suggestPlaces } from '../lib/gazetteer.mjs';
import { CaseBoard } from '../lib/case-board.mjs';
import { applyPhotoEvidence, caseFieldsFrom, joinCase, relatedOpenCases, updateFromCall } from '../lib/intake.mjs';
import { PlaceCheck } from '../lib/place-check.mjs';
import { CaseStore, priorityScore } from '../lib/store.mjs';

test('resolves exact, transliterated and ASR-garbled place names', () => {
  assert.equal(resolveLocation({ area: 'Bahera', district: 'Darbhanga' }).place, 'Bahera');
  assert.equal(resolveLocation({ area: 'बहेड़ा' }).place, 'Bahera');
  assert.equal(resolveLocation({ area: 'Hayghat' }).place, 'Hayaghat');
  assert.equal(resolveLocation({ area: 'Lehriasarai', landmark: 'bridge' }).place, 'Laheriasarai');
  assert.equal(resolveLocation({ area: 'Kusheshwarsthan' }).place, 'Kusheshwar Asthan');
});

test('prefers the most specific place and never matches a truncated fragment', () => {
  assert.equal(resolveLocation({ area: 'Danapur Diara' }).place, 'Danapur Diara');
  assert.equal(resolveLocation({ area: 'Vijayanagar, Velachery', district: 'Chennai' }).place, 'Vijayanagar');
  const truncated = resolveLocation({ area: 'Bahad', district: 'Darbhanga' });
  assert.equal(truncated.place, null);
  assert.equal(truncated.districtKey, 'darbhanga');
  assert.equal(truncated.approximate, true);
});

test('falls back to the district line the call came in on', () => {
  const location = { area: 'Bahad', landmark: 'Shiv Mandir', district: 'NOT MENTIONED - to be asked' };
  assert.equal(resolveLocation(location).districtKey, null);
  assert.equal(resolveLocation(location, { lineDistrict: 'darbhanga' }).districtKey, 'darbhanga');
  const fields = caseFieldsFrom({ location, headcount: { min: 0, max: 0 } }, { lineDistrict: 'darbhanga' });
  assert.equal(fields.place, 'Bahera'); // by sound, inside the line's district
  assert.equal(fields.approximate, true);
});

test('suggests misheard places for confirmation, by sound and across scripts', () => {
  const top = (text, d) => {
    const s = suggestPlaces(text, d && [d]);
    return `${s.level} ${s.candidates[0]?.place ?? '-'}`;
  };
  assert.equal(top('हम बहेड़ा गांव में फंसे हैं', 'darbhanga'), 'exact Bahera');
  assert.equal(top('मैं बहड से बोल रहा हूँ', 'darbhanga'), 'likely Bahera'); // real ASR output for बहेड़ा
  assert.equal(top('Bahad', 'darbhanga'), 'likely Bahera'); // and never Bahadurpur
  assert.equal(top('Tankarbagh sector three', 'patna'), 'likely Kankarbagh');
  assert.equal(top('मुजफ्फरपुर, औरई से बोल रहे हैं', 'muzaffarpur'), 'likely Aurai');
  assert.equal(top('गायघाटी नहीं, कटरिया गांव', 'muzaffarpur').startsWith('exact'), false); // a longer word is not an exact hit
  assert.equal(top('हम सकरी गांव में फंसे हैं', 'darbhanga'), 'none -');
  assert.equal(top('पानी बहुत ऊपर है, हम छत पर हैं', 'darbhanga'), 'none -');
});

test('at district scale: common words never sound like a village, and same-name villages are asked about', () => {
  const full = { darbhanga: JSON.parse(readFileSync(new URL('../data/gazetteer-full/darbhanga.json', import.meta.url), 'utf8')).places };
  const top = (text) => {
    const s = suggestPlaces(text, ['darbhanga'], { places: full });
    return `${s.level} ${s.candidates.map((c) => c.place).join('|') || '-'}`;
  };
  assert.equal(top('हम पांच लोग हैं'), 'none -'); // not Punach
  assert.equal(top('पानी बहुत ऊपर है'), 'none -'); // not Behta / Behat
  assert.equal(top('Bahadurganj side se bol rahe hain'), 'none -'); // not Sabaul
  assert.equal(top('मनीगाछी स्टेशन के पास'), 'likely Manigachhi'); // "chh" and छ share a key
  assert.match(top('सिंहवाड़ा बाजार के पीछे'), /Singhwara/); // सिंह is written "Singh"
  assert.equal(top('Baheri village'), 'ambiguous Baheri|Baheri'); // two villages of that name
});

test('a place is put to the caller once and confirmed by what the agent records', () => {
  const rec = (area, location_confirmed = false) => ({ location: { area }, location_confirmed });

  const yes = new PlaceCheck(['darbhanga']);
  yes.heard('मैं बहड से बोल रहा हूँ');
  assert.match(yes.note(), /Bahera/);
  yes.recorded(rec('Bahera'), { askedThisTurn: true }); // recorded while asking: not yet confirmed
  assert.equal(yes.confirmed, false);
  yes.heard('हां, सही है');
  assert.equal(yes.note(), undefined);
  yes.recorded(rec('Bahera'), { askedThisTurn: false });
  assert.equal(yes.confirmed, true);

  const no = new PlaceCheck(['muzaffarpur']);
  no.heard('औरई से बोल रहे हैं');
  assert.match(no.note(), /Aurai/);
  no.recorded(rec('Aurai'), { askedThisTurn: true });
  no.heard('नहीं, हम कटरिया गांव में हैं'); // sounds like Katra, but the one question is used up
  assert.equal(no.note(), undefined);
  no.recorded(rec('Katariya'), { askedThisTurn: false });
  assert.equal(no.confirmed, false);

  // An exact name is read back too: keyword biasing can turn an unknown village into a known name.
  const exact = new PlaceCheck(['darbhanga']);
  exact.heard('हम बहेड़ा गांव में हैं');
  assert.match(exact.note(), /Read it back once/);
  exact.recorded(rec('Bahera', true), { askedThisTurn: true }); // the model's flag on the asking turn is ignored
  assert.equal(exact.confirmed, false);
  exact.heard('हां, बहेड़ा ही है'); // already asked about: not asked again
  assert.equal(exact.note(), undefined);
  exact.recorded(rec('Bahera'), { askedThisTurn: false });
  assert.equal(exact.confirmed, true);
});

test('keyword lists include native-script aliases and landmarks', () => {
  const words = keywordsFor(['darbhanga']);
  assert.ok(words.includes('Bahera') && words.includes('बहेड़ा') && words.includes('Shiv Mandir'));
});

test('priority: urgency dominates, vulnerability and waiting time break ties', () => {
  const now = Date.now();
  const base = { urgency: 'high', vulnerable: [], headcountMax: 4, createdAt: now };
  assert.ok(priorityScore({ ...base, urgency: 'critical' }, now) > priorityScore({ ...base, vulnerable: ['child', 'elderly'], headcountMax: 50 }, now));
  assert.ok(priorityScore({ ...base, vulnerable: ['infant'] }, now) > priorityScore(base, now));
  assert.ok(priorityScore(base, now + 30 * 60000) > priorityScore(base, now));
});

test('store flags cases that need a callback', () => {
  const store = new CaseStore();
  const complete = store.create({ area: 'Bahera', place: 'Bahera', headcountMin: 5, headcountMax: 5, urgency: 'critical' });
  const missingCount = store.create({ area: 'Aurai', place: 'Aurai', headcountMax: 0, urgency: 'high' });
  assert.equal(complete.needsCallback, false);
  assert.equal(missingCount.needsCallback, true);
  assert.deepEqual(store.list().map((c) => c.id), [complete.id, missingCount.id]);
});

test('photo evidence raises headcount and water level but never lowers them', () => {
  const store = new CaseStore();
  const c = store.create({ area: 'Bahera', place: 'Bahera', headcountMin: 3, headcountMax: 30, waterLevel: 'knee', urgency: 'high', vulnerable: ['child'] });
  const updated = applyPhotoEvidence(store, c.id, {
    people: { count: 8, boxes: [] },
    scene: { water_level: 'roof', people_visible: 7, vulnerable_visible: ['elderly'], stranded_on: 'roof', rescue_notes: '' },
  });
  assert.equal(updated.headcountMin, 8);
  assert.equal(updated.headcountMax, 30);
  assert.equal(updated.waterLevel, 'roof');
  assert.equal(updated.urgency, 'critical');
  assert.deepEqual(updated.vulnerable.sort(), ['child', 'elderly']);
});

test('maps extractor output onto case columns with resolved coordinates', () => {
  const fields = caseFieldsFrom({
    location: { area: 'Kankarbagh Sector 3', landmark: 'Hanuman Mandir', district: 'Patna' },
    headcount: { min: 4, max: 4 },
    vulnerable: ['elderly'],
    water_level: 'waist',
    urgency: 'high',
    summary_en: 'x',
    missing_info: [],
  });
  assert.equal(fields.place, 'Kankarbagh');
  assert.equal(fields.districtKey, 'patna');
  assert.ok(Math.abs(fields.lat - 25.6) < 0.1);
});

const BAHERA = { districtKey: 'darbhanga', place: 'Bahera', lat: 26.0677516, lon: 86.1220308, area: 'Bahera' };

test('related open cases: same phone first, then same place; other districts and closed cases excluded', () => {
  const store = new CaseStore();
  const shiv = store.create({ ...BAHERA, landmark: 'Shiv Mandir', headcountMin: 5, headcountMax: 5, callback: '' });
  const school = store.create({ ...BAHERA, landmark: 'School', headcountMax: 3 });
  store.create({ districtKey: 'darbhanga', place: 'Hayaghat', area: 'Hayaghat', lat: 26.037, lon: 85.912 });
  store.create({ districtKey: 'patna', place: 'Kankarbagh', area: 'Kankarbagh', lat: 25.6, lon: 85.16, callback: '+91 98100 04321' });
  const rescued = store.create({ ...BAHERA, landmark: 'Pul' });
  store.update(rescued.id, { status: 'rescued' });

  assert.deepEqual(relatedOpenCases(store, { ...BAHERA, callback: '' }).map((c) => c.id), [shiv.id, school.id]);
  const repeat = relatedOpenCases(store, { ...BAHERA, callback: '9810004321' });
  assert.equal(repeat[0].place, 'Kankarbagh'); // the same phone counts in any district
  assert.deepEqual(relatedOpenCases(store, { ...BAHERA }, { exclude: [shiv.id] }).map((c) => c.id), [school.id]);
});

test('case board: a yes joins only a case shown on an earlier turn; a no rules it out', () => {
  const store = new CaseStore();
  const shiv = store.create({ ...BAHERA, landmark: 'Shiv Mandir', headcountMin: 5, headcountMax: 5 });
  const school = store.create({ ...BAHERA, landmark: 'School', headcountMax: 3 });
  const said = (id, caller_confirmed) => ({ existing_case: { id, caller_confirmed } });

  const board = new CaseBoard(store, { callerNumber: '+91 90000 00001' });
  assert.match(board.note(BAHERA), /Shiv Mandir[\s\S]*School/);
  assert.equal(board.recorded(said(shiv.id, 'yes')), null); // shown this turn: a yes now is a guess
  assert.match(board.note(BAHERA), /you asked whether/);
  assert.equal(board.recorded(said('JR-9999', 'yes')), null); // never shown: ignored
  assert.deepEqual(board.recorded(said(shiv.id, 'yes')), { join: shiv.id });
  assert.match(board.note(BAHERA), /confirmed they are part of/);

  const no = new CaseBoard(store);
  no.note(BAHERA);
  no.recorded(said(shiv.id, 'not_asked'));
  no.note(BAHERA);
  assert.deepEqual(no.recorded(said(shiv.id, 'no')), { notSame: shiv.id });
  assert.equal(no.suspect(BAHERA), school.id);
  assert.doesNotMatch(no.note(BAHERA), /Shiv Mandir/);

  assert.equal(new CaseBoard(store).note({ districtKey: 'darbhanga', place: 'Hayaghat', area: 'Hayaghat' }), undefined);

  // A garbled report flagged as a possible duplicate of the Shiv Mandir case is asked about through that case.
  store.create({ ...BAHERA, landmark: 'Shiv Mandir ke peeche', possibleDuplicateOf: shiv.id });
  assert.deepEqual(new CaseBoard(store).related(BAHERA).map((c) => c.id), [shiv.id, school.id]);
});

test('joining a case folds the call in without lowering headcount or urgency', async () => {
  const store = new CaseStore();
  const target = store.create({ ...BAHERA, landmark: 'Shiv Mandir', headcountMin: 5, headcountMax: 5, urgency: 'critical', vulnerable: ['elderly'], reports: [{ callId: 'a' }] });
  const own = store.create({ ...BAHERA, headcountMin: 2, headcountMax: 2, urgency: 'high', waterLevel: 'roof', vulnerable: ['child'], reports: [{ callId: 'b' }] });
  const joined = await joinCase(store, { ownCaseId: own.id, targetId: target.id });
  assert.equal(joined.headcountMax, 5);
  assert.equal(joined.urgency, 'critical');
  assert.equal(joined.waterLevel, 'roof');
  assert.deepEqual(joined.vulnerable.sort(), ['child', 'elderly']);
  assert.equal(joined.reports.length, 2);
  assert.equal(store.get(own.id).status, 'merged');
  assert.deepEqual(store.list().map((c) => c.id), [target.id]);
});

test('a live caller\'s count reaches a shared case only once confirmed', async () => {
  const store = new CaseStore();
  const target = store.create({ ...BAHERA, headcountMin: 5, headcountMax: 5, reports: [{ callId: 'a' }] });
  const guess = store.create({ ...BAHERA, headcountMin: 1, headcountMax: 20, headcountConfirmed: false, reports: [{ callId: 'b' }] });
  assert.equal((await joinCase(store, { ownCaseId: guess.id, targetId: target.id })).headcountMax, 5);
  assert.equal(updateFromCall(store, target.id, { headcountMin: 60, headcountMax: 60, headcountConfirmed: false, vulnerable: [] }).headcountMax, 5);
  assert.equal(updateFromCall(store, target.id, { headcountMin: 7, headcountMax: 7, headcountConfirmed: true, vulnerable: [] }).headcountMax, 7);

  // A photo sent before joining moves with the call, and the people in it still count.
  const withPhoto = store.create({ ...BAHERA, reports: [{ callId: 'c' }] });
  applyPhotoEvidence(store, withPhoto.id, {
    people: { count: 9, boxes: [] },
    scene: { water_level: 'roof', people_visible: 8, vulnerable_visible: [], stranded_on: 'roof', rescue_notes: '' },
  });
  const joined = await joinCase(store, { ownCaseId: withPhoto.id, targetId: target.id });
  assert.equal(joined.headcountMin, 9);
  assert.equal(joined.photoEvidence.caseId, withPhoto.id);
});

// Unit tests for the deterministic parts: place resolution, priority, merging, photo evidence.
//   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keywordsFor, resolveLocation } from '../lib/gazetteer.mjs';
import { applyPhotoEvidence, caseFieldsFrom } from '../lib/intake.mjs';
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

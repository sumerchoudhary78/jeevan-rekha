import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { deviceLocation, distanceKm, withDeviceLocation } from '../lib/location.mjs';
import { relatedOpenCases, updateFromCall } from '../lib/intake.mjs';
import { CaseStore } from '../lib/store.mjs';
import { resolveLocation } from '../lib/gazetteer.mjs';
import { locateDevice } from '../public/location.js';

const fix = { lat: 25.611, lon: 85.14, accuracy: 20 };

test('device coordinates reject malformed numbers and impossible bounds', () => {
  assert.deepEqual(deviceLocation({ ...fix, secret: 'not kept' }), fix);
  for (const invalid of [null, {}, [], { ...fix, lat: '25.6' }, { ...fix, lat: NaN }, { ...fix, lon: Infinity },
    { ...fix, lat: 91 }, { ...fix, lon: -181 }, { ...fix, accuracy: -1 }, { ...fix, accuracy: 100001 }]) {
    assert.equal(deviceLocation(invalid), null);
  }
  assert.deepEqual(deviceLocation({ lat: 0, lon: 0, accuracy: 0 }), { lat: 0, lon: 0, accuracy: 0 });
});

test('an unknown rescue address without GPS or district does not acquire an arbitrary district-centre pin', () => {
  const location = resolveLocation({ area: 'Unknown rooftop', landmark: '', district: '' });
  assert.equal(location.lat, null);
  assert.equal(location.lon, null);
  assert.equal(location.districtKey, null);
});

test('device fix improves a local case without inventing a street address', () => {
  const fields = { area: '', landmark: 'Water tower', lat: null, lon: null, approximate: true };
  const actual = withDeviceLocation(fields, fix);
  assert.equal(actual.lat, fix.lat);
  assert.equal(actual.lon, fix.lon);
  assert.equal(actual.locationSource, 'device');
  assert.equal(actual.locationAccuracy, 20);
  assert.equal(actual.area, '');
  assert.equal(actual.approximate, true);
});

test('a confirmed rescue locality far from the phone wins, while a nearby fix keeps its precision', () => {
  const distant = { area: 'Velachery', place: 'Velachery', lat: 12.98, lon: 80.22, approximate: false };
  const actual = withDeviceLocation(distant, fix, { confirmed: true });
  assert.equal(actual.locationSource, 'reported');
  assert.equal(actual.lat, distant.lat);
  assert.equal(actual.locationAccuracy, null);
  const nearby = withDeviceLocation({ place: 'Kankarbagh', lat: 25.61, lon: 85.141, approximate: false }, fix, { confirmed: true });
  assert.equal(nearby.locationSource, 'device');
  assert.equal(nearby.lat, fix.lat);
  assert.equal(nearby.approximate, false);
  assert.equal(withDeviceLocation({ approximate: false }, { ...fix, accuracy: 600 }).approximate, true);
});

test('device cases find nearby reports without a district name but do not move a shared rescue case', () => {
  const store = new CaseStore();
  const target = store.create({ ...withDeviceLocation({ area: '', approximate: true }, fix), reports: [{ callId: 'a' }, { callId: 'b' }] });
  const unrelated = store.create({ ...withDeviceLocation({ area: '', approximate: true }, { ...fix, lat: 13 }), reports: [] });
  const nearby = withDeviceLocation({}, { ...fix, lat: fix.lat + 0.001 });
  assert.deepEqual(relatedOpenCases(store, nearby).map((c) => c.id), [target.id]);
  const updated = updateFromCall(store, target.id, {
    ...nearby, headcountMin: 0, headcountMax: 0, vulnerable: [], waterLevel: 'unknown', urgency: 'high',
  });
  assert.equal(updated.lat, target.lat);
  assert.equal(updated.lon, target.lon);
  assert.ok(distanceKm(target, unrelated) > 1000);
});

test('an accurate device point and landmark satisfy location without an invented area name', () => {
  const store = new CaseStore();
  const fields = { ...withDeviceLocation({ area: '', landmark: 'Water tower', approximate: true }, fix), headcountMax: 4 };
  assert.equal(store.create(fields).needsCallback, false);
  assert.equal(store.create({ ...fields, locationAccuracy: 600 }).needsCallback, true);
});

test('older case databases acquire device-location columns without losing existing reports', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'jeevan-location-db-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'cases.sqlite');
  const old = new CaseStore(path);
  const original = old.create({ area: 'Bahera', reports: [{ callId: 'legacy', transcript: 'Original call' }] });
  const raw = new DatabaseSync(path);
  raw.exec('ALTER TABLE cases DROP COLUMN locationSource; ALTER TABLE cases DROP COLUMN locationAccuracy;');
  raw.close();
  const migrated = new CaseStore(path);
  assert.equal(migrated.get(original.id).locationSource, 'reported');
  assert.equal(migrated.get(original.id).reports[0].transcript, 'Original call');
  assert.equal(migrated.create(withDeviceLocation({}, fix)).locationAccuracy, 20);
});

test('browser location requests a bounded fresh fix and sends coordinates only', async () => {
  let options;
  const result = await locateDevice({ geolocation: { getCurrentPosition(success, error, opts) {
    options = opts;
    success({ coords: { latitude: fix.lat, longitude: fix.lon, accuracy: fix.accuracy, altitude: 9 } });
  } } });
  assert.deepEqual(result, fix);
  assert.equal(options.enableHighAccuracy, true);
  assert.ok(options.timeout < 8000);
  assert.ok(options.maximumAge <= 30000);
});

test('denied, unavailable and cancelled location all settle without blocking a call', async () => {
  await assert.rejects(locateDevice({ geolocation: null }), /unavailable/);
  await assert.rejects(locateDevice({ geolocation: { getCurrentPosition(success, error) { error({ code: 1 }); } } }), /not shared/);
  const controller = new AbortController();
  let lateSuccess;
  const pending = locateDevice({ signal: controller.signal, geolocation: {
    getCurrentPosition(success) { lateSuccess = success; },
  } });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  lateSuccess({ coords: { latitude: 1, longitude: 2, accuracy: 10 } });
});

test('an unanswered browser permission prompt has a hard application deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = locateDevice({ geolocation: { getCurrentPosition() {} } });
  const assertion = assert.rejects(pending, /timed out/);
  t.mock.timers.tick(8000);
  await assertion;
});

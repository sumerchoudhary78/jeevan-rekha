import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { CallSession } from '../lib/call-session.mjs';
import { CaseStore } from '../lib/store.mjs';

const fix = { lat: 25.611, lon: 85.14, accuracy: 18 };
const record = (extra = {}) => ({
  rescue_at_device: 'unknown', location: { area: '', landmark: 'Water tower', district: '' },
  location_confirmed: false, headcount: { min: 4, max: 4 }, headcount_confirmed: true,
  existing_case: { id: '', caller_confirmed: 'not_asked' }, vulnerable: [], water_level: 'waist',
  urgency: 'high', callback_number: '', missing_info: [], summary_en: 'Four people near the water tower.', ...extra,
});

function call(t, records) {
  const previous = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = 'test-meta-key';
  t.after(() => { if (previous === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = previous; });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      say: 'What is the water level?', say_lang: 'en-IN', record: records.shift(), call_complete: false,
    }) } }] });
  });
  const asr = Object.assign(new EventEmitter(), { write() {}, end() {}, close() {} });
  const bus = new EventEmitter();
  const messages = [];
  const store = new CaseStore();
  const session = new CallSession({ store, bus, asr, send: (m) => messages.push(m), lang: 'en-IN', callerNumber: '+91 98100 01234' });
  const say = (text) => new Promise((resolve, reject) => {
    const listener = (message) => {
      if (message.type !== 'agent' && message.type !== 'error') return;
      bus.off('call', listener);
      if (message.type === 'error') reject(new Error(message.message));
      else resolve(message);
    };
    bus.on('call', listener);
    asr.emit('turn', { text });
  });
  return { session, store, messages, requests, say };
}

test('a real call session binds shared coordinates to its own case and emits the map location', async (t) => {
  const { session, store, requests, say } = call(t, [record()]);
  assert.equal(session.setLocation(fix), true);
  const response = await say('We are four people near the water tower.');
  const c = store.get(response.caseId);
  assert.equal(c.lat, fix.lat);
  assert.equal(c.lon, fix.lon);
  assert.equal(c.locationAccuracy, 18);
  assert.equal(c.area, '');
  assert.deepEqual(c.reports[0].deviceLocation, fix);
  assert.equal(response.caseLocation.source, 'device');
  assert.match(requests[0].messages[1].content, /DEVICE LOCATION/);
  assert.ok(requests[0].response_format.json_schema.schema.properties.record.required.includes('rescue_at_device'));
});

test('a delayed device fix updates the existing case rather than opening another one', async (t) => {
  const { session, store, messages, say } = call(t, [record({ location: { area: 'Kankarbagh Sector 3', landmark: 'Water tower', district: 'Patna' } })]);
  const first = await say('We are in Kankarbagh sector three in Patna.');
  session.setLocation(fix);
  assert.equal(store.list().length, 1);
  assert.equal(store.get(first.caseId).lat, fix.lat);
  assert.equal(messages.at(-1).type, 'location');
  assert.equal(messages.at(-1).caseId, first.caseId);
});

test('a caller saying rescue is elsewhere removes the phone position from the rescue pin', async (t) => {
  const away = record({ rescue_at_device: 'no', location: { area: 'Velachery', landmark: 'School', district: 'Chennai' }, location_confirmed: true });
  const { session, store, say } = call(t, [record(), away, record({ location: { area: 'Unknown rooftop', landmark: 'School', district: '' } })]);
  session.setLocation(fix);
  const first = await say('Four people near the water tower.');
  await say('I am calling about my family in Velachery, Chennai, not from the rescue location.');
  const c = store.get(first.caseId);
  assert.equal(c.locationSource, 'reported');
  assert.notEqual(c.lat, fix.lat);
  assert.equal(c.place, 'Velachery');
  assert.equal(c.locationAccuracy, null);
  await say('I do not know the exact address of their rooftop.');
  assert.equal(store.get(first.caseId).locationSource, 'reported');
  assert.equal(store.get(first.caseId).lat, null);
});

test('a call without location permission continues using the spoken rescue address', async (t) => {
  const { session, store, say } = call(t, [record({ location: { area: 'Bahera', landmark: 'School', district: 'Darbhanga' } })]);
  assert.equal(session.setLocation({ lat: 999, lon: 0, accuracy: 10 }), false);
  const response = await say('We are in Bahera, Darbhanga, near the school.');
  const c = store.get(response.caseId);
  assert.equal(c.locationSource, 'reported');
  assert.equal(c.place, 'Bahera');
  assert.equal(c.reports[0].deviceLocation, undefined);
});

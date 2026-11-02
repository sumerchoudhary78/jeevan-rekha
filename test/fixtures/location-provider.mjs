// Local integration fixture: replace Meta audio/model calls, never production code.
import { registerHooks } from 'node:module';
import { CaseStore } from '../../lib/store.mjs';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('/lib/asr-realtime.mjs')) return {
      format: 'module', shortCircuit: true,
      source: `import { EventEmitter } from 'node:events';
        export class RealtimeTranscriber extends EventEmitter {
          spoken = false;
          write(bytes) {
            const text = bytes.toString('utf8');
            if (text.startsWith('TEST:')) return this.emit('turn', {text: text.slice(5)});
            if (!this.spoken && bytes.some(b => b !== 0)) {
              this.spoken = true;
              this.emit('turn', {text: 'Four people near the water tower. The water is rising.'});
            }
          }
          end() {}
          close() {}
        }`,
    };
    return nextLoad(url, context);
  },
});

globalThis.fetch = async (url, options) => {
  if (!String(url).endsWith('/chat/completions')) throw new Error('Unexpected outbound test request');
  const request = JSON.parse(options.body);
  const transcript = request.messages.at(-1).content;
  const elsewhere = transcript.includes('rescue elsewhere');
  const gps = transcript.includes('DEVICE LOCATION');
  const record = {
    rescue_at_device: elsewhere ? 'no' : 'unknown',
    location: elsewhere ? { area: 'Velachery', landmark: 'School', district: 'Chennai' } :
      gps ? { area: '', landmark: 'Water tower', district: '' } : { area: 'Bahera', landmark: 'School', district: 'Darbhanga' },
    location_confirmed: false, headcount: { min: 4, max: 4 }, headcount_confirmed: true,
    existing_case: { id: '', caller_confirmed: 'not_asked' }, vulnerable: [], water_level: 'waist',
    urgency: 'high', callback_number: '', missing_info: [], summary_en: 'Four people need rescue near the water tower.',
  };
  return Response.json({ choices: [{ message: { content: JSON.stringify({
    say: 'Your location is recorded. Are there children or elderly people with you?',
    say_lang: 'en-IN', record, call_complete: false,
  }) } }] });
};

if (process.env.LOCATION_TEST_SEED === '1') {
  const store = new CaseStore(process.env.STORE_PATH);
  store.create({ area: '', landmark: 'Water tower', lat: 25.611, lon: 85.14, locationSource: 'device', locationAccuracy: 18,
    headcountMin: 2, headcountMax: 2, urgency: 'critical', reports: [{ callId: 'seed-a', transcript: 'Two people near the water tower.' }] });
  store.create({ area: 'Bahera', place: 'Bahera', district: 'Darbhanga', districtKey: 'darbhanga', landmark: 'School',
    lat: 26.06, lon: 86.13, headcountMin: 3, headcountMax: 3, urgency: 'medium',
    reports: [{ callId: 'seed-b', transcript: 'Three people near the school in Bahera.' }] });
}

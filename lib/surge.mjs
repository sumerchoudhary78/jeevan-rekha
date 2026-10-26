import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { extractDistressCall } from './extract.mjs';
import { keywordsFor, languageBiasFor } from './gazetteer.mjs';
import { caseFieldsFrom, recordReport } from './intake.mjs';
import { transcribe } from './meta.mjs';

const surgeDir = join(import.meta.dirname, '..', 'data', 'surge');
const LANG_BIAS = { hi: ['Hindi', 'English'], en: ['English', 'Hindi'], ta: ['Tamil', 'English'], te: ['Telugu', 'English'] };

export function loadSurgeCalls() {
  return JSON.parse(readFileSync(join(surgeDir, 'calls.json'), 'utf8')).calls;
}

// Replays a flood night: recorded calls arrive staggered and overlapping, each is
// transcribed with district keyword biasing, extracted, and merged or opened as a case.
export async function runSurge({ store, bus, concurrency = 4, spacingMs = 2500, limit } = {}) {
  const calls = loadSurgeCalls().slice(0, limit);
  const stats = { calls: calls.length, done: 0, merged: 0, failed: 0 };
  bus.emit('surge', { type: 'surge-started', ...stats });

  let next = 0;
  async function worker(slot) {
    await sleep(slot * spacingMs);
    while (next < calls.length) {
      const call = calls[next++];
      const callId = `sim-${call.id}`;
      const emit = (type, payload = {}) => bus.emit('call', { type, callId, simulated: true, ...payload });
      try {
        emit('started', { lang: call.lang, district: call.district });
        const asr = await transcribe(join(surgeDir, 'audio', `${call.id}.wav`), {
          keywords: keywordsFor([call.district]),
          languageBias: LANG_BIAS[call.lang] ?? languageBiasFor(call.district),
        });
        emit('caller', { text: asr.text });
        const { data } = await extractDistressCall(asr.text);
        const fields = { ...caseFieldsFrom(data), source: 'surge' };
        const report = { at: Date.now(), source: 'surge', callId, transcript: asr.text };
        const { case: c, merged, relation, reason, possibleDuplicateOf } = await recordReport(store, fields, report);
        if (merged) stats.merged++;
        emit(merged ? 'merged' : 'opened', { caseId: c.id, relation, reason, possibleDuplicateOf, group: call.group });
        emit('ended', { caseId: c.id });
      } catch (err) {
        stats.failed++;
        emit('error', { message: err.message });
      }
      stats.done++;
      bus.emit('surge', { type: 'surge-progress', ...stats });
      await sleep(spacingMs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  bus.emit('surge', { type: 'surge-finished', ...stats });
  return stats;
}

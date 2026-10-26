import { randomUUID } from 'node:crypto';
import { agentTurn, GREETINGS } from './agent.mjs';
import { RealtimeTranscriber } from './asr-realtime.mjs';
import { gazetteer, keywordsFor } from './gazetteer.mjs';
import { caseFieldsFrom, recordReport, updateFromCall } from './intake.mjs';

const LANGUAGE_BIAS = {
  'hi-IN': ['Hindi', 'English'],
  'en-IN': ['English', 'Hindi'],
  'ta-IN': ['Tamil', 'English'],
  'te-IN': ['Telugu', 'English'],
  'kn-IN': ['Kannada', 'English'],
  'mr-IN': ['Marathi', 'Hindi'],
  'bn-IN': ['Bengali', 'English'],
};

const CASE_NUMBER_LINE = {
  'hi-IN': (n) => `आपका केस नंबर ${n} है।`,
  'en-IN': (n) => `Your case number is ${n}.`,
  'ta-IN': (n) => `உங்கள் வழக்கு எண் ${n}.`,
  'te-IN': (n) => `మీ కేసు నంబర్ ${n}.`,
};
const caseNumber = (id) => String(Number(id.replace('JR-', '')));

// One live caller: streams their audio to Muse Voice Transcribe, runs the call-taker
// agent on every finished speech turn, and keeps the rescue case up to date.
//   send(msg)  pushes JSON to the caller's client
//   bus        receives call events for the control room
export class CallSession {
  id = randomUUID().slice(0, 8);
  caseId = null;
  history = [];
  #pendingCaller = [];
  #thinking = false;
  #ended = false;

  constructor({ store, bus, send, lang = 'hi-IN', district, callerNumber = '', source = 'call' }) {
    Object.assign(this, { store, bus, send, lang, callerNumber, source });
    this.knownPlaces = (district ? [gazetteer[district]] : Object.values(gazetteer))
      .filter(Boolean)
      .flatMap((d) => d.places.map((p) => p.name));
    this.asr = new RealtimeTranscriber({
      keywords: keywordsFor(district ? [district] : undefined),
      languageBias: LANGUAGE_BIAS[lang],
      sessionId: `jr-${this.id}`,
    });
    this.asr.on('partial', (text) => this.#emit('partial', { text }));
    this.asr.on('turn', ({ text }) => this.#onCallerTurn(text));
    this.asr.on('error', (err) => this.#emit('error', { message: err.message }));

    const greeting = GREETINGS[lang] ?? GREETINGS['en-IN'];
    this.history.push({ role: 'agent', text: greeting });
    this.#emit('started', { lang, callerNumber });
    this.#emit('agent', { text: greeting, lang });
  }

  #emit(type, payload) {
    const msg = { type, callId: this.id, caseId: this.caseId, ...payload };
    this.send?.(msg);
    this.bus.emit('call', msg);
  }

  audio(pcm) {
    if (!this.#ended) this.asr.write(pcm);
  }

  async #onCallerTurn(text) {
    this.history.push({ role: 'caller', text });
    this.#emit('caller', { text });
    this.#pendingCaller.push(text);
    if (this.#thinking) return; // folded into the next agent turn
    this.#thinking = true;
    try {
      while (this.#pendingCaller.length && !this.#ended) {
        this.#pendingCaller = [];
        const turn = await agentTurn(this.history, { callerNumber: this.callerNumber, knownPlaces: this.knownPlaces });
        await this.#applyRecord(turn.record, text);
        let say = turn.say;
        if (turn.call_complete && this.caseId) {
          const line = CASE_NUMBER_LINE[turn.say_lang] ?? CASE_NUMBER_LINE['en-IN'];
          say = `${line(caseNumber(this.caseId))} ${say}`;
        }
        this.history.push({ role: 'agent', text: say });
        this.#emit('agent', { text: say, lang: turn.say_lang, record: turn.record, complete: turn.call_complete });
        if (turn.call_complete) this.#emit('complete', {});
      }
    } catch (err) {
      this.#emit('error', { message: err.message });
    } finally {
      this.#thinking = false;
    }
  }

  async #applyRecord(record, lastCallerText) {
    const fields = caseFieldsFrom(record);
    fields.callback = record.callback_number || this.callerNumber;
    const transcript = this.history.map((t) => `${t.role === 'caller' ? 'Caller' : 'Agent'}: ${t.text}`).join('\n');

    if (this.caseId) {
      updateFromCall(this.store, this.caseId, fields);
      this.#attachTranscript(transcript);
      return;
    }
    // Open a case once we know where, or immediately if lives are at risk.
    if (fields.area || fields.urgency === 'critical') {
      const report = { at: Date.now(), source: this.source, callId: this.id, transcript: lastCallerText };
      const { case: c, merged, relation, reason, possibleDuplicateOf } = await recordReport(this.store, { ...fields, source: this.source }, report);
      this.caseId = c.id;
      this.#attachTranscript(transcript);
      this.#emit(merged ? 'merged' : 'opened', { caseId: c.id, relation, reason, possibleDuplicateOf });
    }
  }

  #attachTranscript(transcript) {
    const c = this.store.get(this.caseId);
    const reports = c.reports.map((r) => (r.callId === this.id ? { ...r, transcript } : r));
    this.store.update(this.caseId, { reports });
  }

  end() {
    if (this.#ended) return;
    this.#ended = true;
    this.asr.end();
    setTimeout(() => this.asr.close(), 3000);
    this.#emit('ended', {});
  }
}

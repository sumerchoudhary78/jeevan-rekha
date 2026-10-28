import { randomUUID } from 'node:crypto';
import { agentTurn, GREETINGS } from './agent.mjs';
import { RealtimeTranscriber } from './asr-realtime.mjs';
import { CaseBoard } from './case-board.mjs';
import { gazetteer, keywordsFor } from './gazetteer.mjs';
import { caseFieldsFrom, joinCase, recordReport, updateFromCall } from './intake.mjs';
import { PlaceCheck } from './place-check.mjs';

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
//   asr        optional stand-in for the transcriber (tests feed text 'turn' events)
export class CallSession {
  id = randomUUID().slice(0, 8);
  caseId = null;
  history = [];
  #fields = null; // the case fields from the agent's latest record
  #pendingCaller = [];
  #thinking = false;
  #ended = false;

  constructor({ store, bus, send, lang = 'hi-IN', district, callerNumber = '', source = 'call', asr }) {
    Object.assign(this, { store, bus, send, lang, callerNumber, source, lineDistrict: district });
    this.districtName = gazetteer[district]?.places.find((p) => p.kind === 'district').name;
    this.place = new PlaceCheck(district ? [district] : undefined);
    this.board = new CaseBoard(store, { callerNumber });
    this.asr =
      asr ??
      new RealtimeTranscriber({
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
    this.place.heard(text);
    if (this.#thinking) return; // folded into the next agent turn
    this.#thinking = true;
    try {
      while (this.#pendingCaller.length && !this.#ended) {
        this.#pendingCaller = [];
        const placeCheck = this.place.note();
        const caseBoard = this.board.note(this.#location(), this.caseId);
        const turn = await agentTurn(this.history, { callerNumber: this.callerNumber, district: this.districtName, placeCheck, caseBoard });
        this.place.recorded(turn.record, { askedThisTurn: !!placeCheck });
        await this.#applyRecord(turn.record, text, this.board.recorded(turn.record));
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

  // Where the caller is, as far as the call knows: their open case, the agent's last record,
  // or a known place they named exactly.
  #location() {
    const own = this.caseId && this.store.get(this.caseId);
    if (own?.place) return own;
    if (this.#fields?.place) return this.#fields;
    const p = this.place.best;
    return p ? { districtKey: p.district, place: p.place, lat: p.lat, lon: p.lon, area: p.place } : this.#fields;
  }

  // `answer` is the case board's reading of this turn ({ join } when the caller confirmed
  // they are a group already reported).
  async #applyRecord(record, lastCallerText, answer) {
    const fields = caseFieldsFrom(record, { lineDistrict: this.lineDistrict });
    fields.callback = record.callback_number || this.callerNumber;
    if (!this.place.confirmed) fields.approximate = true; // shown as unconfirmed until the caller agrees
    this.#fields = fields;
    const transcript = this.history.map((t) => `${t.role === 'caller' ? 'Caller' : 'Agent'}: ${t.text}`).join('\n');
    const report = { at: Date.now(), source: this.source, callId: this.id, transcript: lastCallerText };

    if (answer?.join) {
      const c = await joinCase(this.store, { ownCaseId: this.caseId, targetId: answer.join, fields: { ...fields, source: this.source }, report });
      this.caseId = c.id;
      updateFromCall(this.store, c.id, fields);
      this.#attachTranscript(transcript, { joinedByCaller: true });
      this.#emit('merged', { caseId: c.id, relation: 'same_group', reason: 'The caller confirmed they are part of this group.' });
      return;
    }
    if (this.caseId) {
      updateFromCall(this.store, this.caseId, fields);
      this.#attachTranscript(transcript);
      this.#flagSuspect();
      return;
    }
    // Open a case once we know where, or immediately if lives are at risk. No duplicate
    // judge here: the caller is on the line, so the case board asks them instead.
    if (fields.area || fields.urgency === 'critical') {
      const { case: c } = await recordReport(this.store, { ...fields, source: this.source }, report, { judge: false });
      this.caseId = c.id;
      this.#attachTranscript(transcript);
      this.#emit('opened', { caseId: c.id, possibleDuplicateOf: this.#flagSuspect() });
    }
  }

  // Until the caller has answered, a human sees which open case this call may duplicate;
  // cases the caller said they are not part of are recorded on the case.
  #flagSuspect() {
    const own = this.store.get(this.caseId);
    const possibleDuplicateOf = this.board.suspect(this.#location(), this.caseId);
    if (own.possibleDuplicateOf !== possibleDuplicateOf || own.notDuplicateOf.length !== this.board.ruledOut.length) {
      this.store.update(this.caseId, { possibleDuplicateOf, notDuplicateOf: [...this.board.ruledOut] });
    }
    return possibleDuplicateOf;
  }

  #attachTranscript(transcript, extra = {}) {
    const c = this.store.get(this.caseId);
    const reports = c.reports.map((r) => (r.callId === this.id ? { ...r, ...extra, transcript } : r));
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

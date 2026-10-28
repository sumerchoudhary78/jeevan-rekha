// Checks the call-taker against the live case board. A caller who is part of a group already
// reported should be asked once and joined to that case without re-asking what it knows or
// changing its headcount; a different family at the same place gets its own case; a repeat
// caller is recognised by number and told the case's status; with nothing reported nearby
// there is no such question.
// Runs the real CallSession (agent, place check, case board, case store), with text in place
// of audio. Each caller is played by a second model (the triage model, open weights by
// default) from a short persona, so the answers follow whatever the agent actually asks.
//   node --env-file=.env scripts/board-dialog.mjs [runs] [--verbose] [--only=<part of a scenario name>]
import { EventEmitter } from 'node:events';
import { CallSession } from '../lib/call-session.mjs';
import { caseFieldsFrom } from '../lib/intake.mjs';
import { chatJson } from '../lib/meta.mjs';
import { CaseStore } from '../lib/store.mjs';

// Stands in for the realtime transcriber: the script emits finished caller turns as text.
class TextLine extends EventEmitter {
  write() {}
  end() {}
  close() {}
}

const record = (area, landmark, district, n, vulnerable, water_level, urgency, summary_en) => ({
  location: { area, landmark, district },
  headcount: { min: n, max: n },
  headcount_confirmed: true,
  vulnerable,
  water_level,
  urgency,
  summary_en,
  missing_info: [],
});
const BAHERA_SHIV = record('Bahera', 'Shiv Mandir', 'Darbhanga', 5, ['elderly', 'disabled_or_immobile'], 'chest_or_window', 'critical',
  'Five people in the house behind the Shiv temple in Bahera; the mother cannot walk; water at window level.');
const BAHERA_SCHOOL = record('Bahera', 'School', 'Darbhanga', 3, [], 'knee', 'medium',
  'Three people in a house near the school in Bahera, safe for now, out of food.');
const KANKARBAGH = record('Kankarbagh Sector 3', 'Hanuman Mandir', 'Patna', 4, ['elderly'], 'waist', 'high',
  'Four people on the first floor near the Hanuman Mandir, Kankarbagh Sector 3; father is 80.');

const REPEAT_NUMBER = '+91 98100 04321';
const MAX_TURNS = 8;

const SCENARIOS = [
  {
    name: 'same group, caller confirms (Hindi)',
    district: 'darbhanga',
    lang: 'hi-IN',
    seed: [{ rec: BAHERA_SHIV }, { rec: BAHERA_SCHOOL }],
    opening: 'हैलो, हम बहेड़ा गांव में फंसे हैं, शिव मंदिर के पीछे वाले घर में',
    persona:
      'You are in Bahera village, Darbhanga, in the house behind the Shiv temple. You are one of the 5 people your brother reported ' +
      'when he called earlier; your mother cannot walk. Since his call the water has risen to the roof. If asked whether you are ' +
      'the group already reported, say yes.',
    expect: { joins: 0, openCases: 2 },
  },
  {
    name: 'same group, also a garbled duplicate report',
    district: 'darbhanga',
    lang: 'hi-IN',
    seed: [
      { rec: BAHERA_SHIV },
      { rec: record('Bahad', 'Shiv Mandir ke peeche, Ram Babu ji ka ghar', '', 0, ['elderly'], 'unknown', 'high', 'People trapped behind the Shiv temple, elderly mother.'), duplicateOf: 0 },
    ],
    opening: 'हैलो, हम बहेड़ा गांव में फंसे हैं, शिव मंदिर के पीछे वाले घर में',
    persona:
      'You are in Bahera village, Darbhanga, in the house behind the Shiv temple. You are one of the 5 people your brother reported ' +
      'when he called earlier; your mother cannot walk. Since his call the water has risen to the roof. If asked whether you are ' +
      'the group already reported, say yes.',
    expect: { joins: 0, openCases: 2 },
  },
  {
    name: 'same place, different family (Hindi)',
    district: 'darbhanga',
    lang: 'hi-IN',
    seed: [{ rec: BAHERA_SHIV }, { rec: BAHERA_SCHOOL }],
    opening: 'हम बहेड़ा गांव में हैं, शिव मंदिर के पास वाली गली में',
    persona:
      'You are in Bahera village, Darbhanga, in a lane near the Shiv temple, in a different house from the family of 5 your ' +
      'neighbours reported. You are 4 adults; nobody is sick and there are no children; the water is waist-deep. If asked ' +
      'whether you are that family, say no, they are your neighbours.',
    expect: { joins: null, openCases: 3, ruledOut: 0 },
  },
  {
    name: 'caller unsure, different headcount',
    district: 'darbhanga',
    lang: 'hi-IN',
    seed: [{ rec: BAHERA_SHIV }],
    opening: 'हम बहेड़ा गांव में फंसे हैं, शिव मंदिर के पास',
    persona:
      'You are in Bahera village near the Shiv temple. You do not know whether anyone reported you. You are 6 people, including ' +
      '2 small children; the water is knee-deep. If asked whether you are a group of 5 already reported, say you do not know ' +
      'who called, and that you are 6.',
    expect: { joins: null, openCases: 2 },
  },
  {
    name: 'repeat caller, boat already assigned',
    district: 'darbhanga',
    lang: 'hi-IN',
    callerNumber: REPEAT_NUMBER,
    seed: [{ rec: BAHERA_SHIV, callback: REPEAT_NUMBER, assignedTeam: 'Boat 7' }],
    opening: 'हैलो, मैंने पहले फोन किया था, अभी तक कोई नहीं आया, पानी बढ़ रहा है',
    persona:
      'You called this helpline earlier from this same phone about your family in Bahera, in the house behind the Shiv temple ' +
      '(5 people, your mother cannot walk). Nobody has come yet. The water has now reached the roof. If asked, confirm it is ' +
      'the same place and family.',
    expect: { joins: 0, openCases: 1, mentionsBoat: true },
  },
  {
    name: 'nothing reported nearby, no board question',
    district: 'darbhanga',
    lang: 'hi-IN',
    seed: [{ rec: BAHERA_SHIV }],
    opening: 'हायाघाट में हम छह लोग एक छत पर फंसे हैं, पानी कमर तक है',
    persona: 'You are 6 people on the roof of a house in Hayaghat, Darbhanga, near the block office; the water is waist-deep; one of you is an elderly man.',
    maxTurns: 3,
    expect: { joins: null, openCases: 2, noBoardQuestion: true },
  },
  {
    name: 'same group, caller confirms (English)',
    district: 'patna',
    lang: 'en-IN',
    seed: [{ rec: KANKARBAGH }],
    opening: 'Hello, I am in Kankarbagh sector three, near the Hanuman temple, the water is rising',
    persona:
      'You are in Kankarbagh Sector 3, Patna, near the Hanuman temple. You are one of the 4 people your son reported when he ' +
      'called earlier; your 80-year-old father is with you. The water is now at the first-floor windows. If asked whether you ' +
      'are the group already reported, say yes.',
    expect: { joins: 0, openCases: 1 },
  },
];

// The simulated caller's next line, given the call so far.
async function callerLine(s, history) {
  const transcript = history.map((t) => `${t.role === 'caller' ? 'YOU' : 'CALL-TAKER'}: ${t.text}`).join('\n');
  const { data } = await chatJson({
    system:
      `You are playing a person calling a flood rescue helpline in India. Stay in character: ${s.persona}\n` +
      `Answer only what the call-taker just asked, in one short sentence, in ${s.lang === 'en-IN' ? 'English' : 'Hindi (Devanagari script)'}, ` +
      'as a real caller would. Never mention case numbers. If the call-taker is closing the call, just say thanks.',
    user: `The call so far:\n${transcript}\n\nWrite your next line.`,
    schemaName: 'CallerLine',
    schema: { type: 'object', additionalProperties: false, properties: { line: { type: 'string' } }, required: ['line'] },
  });
  return data.line;
}

const ARRIVAL_TIME = /\d+\s*(मिनट|घंटे|minutes?|hours?)\s*(में|के अंदर|in|within)|will (reach|arrive|be there)|(पहुंच|पहुँच)(ेगी|ेंगे|ेगा|\s*जाएगी|\s*जाएंगे|\s*जाएगा)/i;
const ASKS_HEADCOUNT = /कितने\s*(लोग|लोगों)|how many (people|of you)/i;
const MENTIONS_EARLIER = /पहले\s*(से|भी|ही)?\s*(फोन|कॉल|खबर|रिपोर्ट|बताया|जानकारी)|पहले से|already (reported|called|told)|earlier|someone (else )?(has )?reported/i;
const MENTIONS_BOAT = /नाव|बोट|boat|टीम|team/i;

function seedCase(store, { rec, callback = '', assignedTeam, duplicateOf }, i, seeded, lineDistrict) {
  const c = store.create({
    ...caseFieldsFrom(rec, { lineDistrict }),
    source: 'surge',
    callback,
    approximate: duplicateOf !== undefined,
    possibleDuplicateOf: duplicateOf === undefined ? null : seeded[duplicateOf].id,
    reports: [{ at: Date.now(), source: 'surge', callId: `seed-${i}`, transcript: rec.summary_en }],
  });
  return assignedTeam ? store.update(c.id, { status: 'assigned', assignedTeam }) : c;
}

async function run(s, n) {
  const store = new CaseStore();
  const seeded = [];
  for (const [i, x] of s.seed.entries()) seeded.push(seedCase(store, x, i, seeded, s.district));
  const asr = new TextLine();
  let joined = false;
  let replied;
  const says = [];
  const send = (msg) => {
    if (msg.type === 'merged') joined = true;
    if (msg.type === 'agent' || msg.type === 'error') replied?.(msg);
  };
  const session = new CallSession({
    store,
    bus: new EventEmitter(),
    send,
    lang: s.lang,
    district: s.district,
    callerNumber: s.callerNumber ?? `+91 90000 1${String(n).padStart(4, '0')}`,
    asr,
  });
  let line = s.opening;
  for (let turn = 0; turn < (s.maxTurns ?? MAX_TURNS); turn++) {
    const reply = new Promise((resolve) => (replied = resolve));
    asr.emit('turn', { text: line });
    const msg = await reply;
    if (msg.type === 'error') throw new Error(msg.message);
    says.push({ text: msg.text, afterJoin: joined, caller: line });
    if (msg.complete) break;
    line = await callerLine(s, session.history);
  }
  session.end();

  const target = s.expect.joins === null ? null : seeded[s.expect.joins];
  const after = target && store.get(target.id);
  const own = session.caseId && store.get(session.caseId);
  const checks = {
    joined: target ? session.caseId === target.id : !seeded.some((c) => c.id === session.caseId),
    cases: store.list().length === s.expect.openCases,
  };
  // None of these callers gives a new count, so the joined case's count must stay as it was:
  // not lowered, and not raised by a guess.
  if (after) checks.countKept = after.headcountMax === target.headcountMax && after.headcountMin === target.headcountMin;
  if (target) checks.noReask = !says.some((t) => t.afterJoin && ASKS_HEADCOUNT.test(t.text));
  if (s.expect.ruledOut !== undefined) checks.ruledOut = !!own && own.notDuplicateOf.includes(seeded[s.expect.ruledOut].id);
  if (s.expect.mentionsBoat) checks.status = says.some((t) => t.afterJoin && MENTIONS_BOAT.test(t.text));
  if (s.expect.noBoardQuestion) checks.noBoardQuestion = !says.some((t) => MENTIONS_EARLIER.test(t.text));
  checks.noArrivalTime = !says.some((t) => ARRIVAL_TIME.test(t.text));
  return { ok: Object.values(checks).every(Boolean), checks, says, caseId: session.caseId };
}

const runs = Number(process.argv[2]) || 1;
const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);
const scenarios = SCENARIOS.filter((s) => !only || s.name.includes(only));
let passed = 0;
let n = 0;
for (let r = 0; r < runs; r++) {
  for (const s of scenarios) {
    // An agent error (e.g. a malformed reply) fails the scenario instead of stopping the run.
    const res = await run(s, n++).catch((err) => ({ ok: false, checks: { error: false }, says: [{ caller: '', text: err.message }], caseId: null }));
    if (res.ok) passed++;
    const marks = Object.entries(res.checks).map(([k, v]) => `${k} ${v ? 'ok' : 'XX'}`).join('  ');
    console.log(`${res.ok ? 'PASS' : 'FAIL'}  ${s.name.padEnd(42)} ${marks}  -> ${res.caseId}`);
    if (!res.ok || process.argv.includes('--verbose')) {
      res.says.forEach((t) => console.log(`        caller : ${t.caller}\n        agent${t.afterJoin ? '*' : ' '}: ${t.text}`));
    }
  }
}
console.log(`\n${passed}/${runs * scenarios.length} scenarios passed`);
process.exit(0);

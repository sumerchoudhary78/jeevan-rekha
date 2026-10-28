import { relatedOpenCases } from './intake.mjs';

const MAX_LISTED = 3;
const MAX_QUESTIONS = 2;

const digits = (s) => (s ?? '').replace(/\D/g, '');

const ON_YES =
  'Tell them their report is now joined to that rescue request and give its status in plain words (never an arrival time, and never that help is coming "soon"). ' +
  'Copy what that case already knows (place, landmark, people, vulnerable, water) into record instead of asking for it again, ' +
  'unless the caller says it has changed, and ask once whether anything has changed since (water, number of people, anyone hurt).';

const people = (c) =>
  c.headcountMax ? `${c.headcountMin === c.headcountMax ? c.headcountMax : `${c.headcountMin}-${c.headcountMax}`} people` : 'unknown number of people';

function describe(c, callerNumber) {
  const sameCaller = digits(callerNumber).length >= 6 && digits(c.callback).includes(digits(callerNumber).slice(-10));
  const status = c.status === 'assigned' ? `boat team assigned (${c.assignedTeam})` : 'waiting in the rescue queue, no boat assigned yet';
  return (
    `${c.id}${sameCaller ? ' (reported earlier from this same phone number)' : ''}: ` +
    `${c.place ?? c.area}${c.landmark ? `, ${c.landmark}` : ''}; ${people(c)}${c.headcountConfirmed ? ' (confirmed)' : ''}; ` +
    `vulnerable: ${c.vulnerable.join(', ') || 'none mentioned'}; water ${c.waterLevel}; ` +
    `reported ${Math.round((Date.now() - c.createdAt) / 60000)} min ago by ${c.reports.length} call(s); ${status}.`
  );
}

// What the live case board says about one caller: open rescue cases at the same place, or
// one this phone number already reported. The agent may ask whether the caller is part of
// one of those groups. The call joins a case only when the agent records a "yes" for a case
// it was shown on an earlier turn, so it cannot merge on a guess made the moment it sees it.
export class CaseBoard {
  joined = null; // the case this call joined after the caller confirmed
  ruledOut = []; // cases the caller said they are not part of
  #firstListed = new Map(); // case id -> turn it was first shown to the agent
  #asked = new Map(); // case id -> turn the agent asked about it
  #turn = 0;

  constructor(store, { callerNumber = '' } = {}) {
    this.store = store;
    this.callerNumber = callerNumber;
  }

  // Open cases this caller may belong to. `location` is the caller's best-known place
  // ({ districtKey, place, lat, lon, area }); the phone number is matched in any case.
  // A report already flagged as a possible duplicate of another of these cases is left out:
  // the caller is asked about the case it may duplicate, so a yes joins the main case.
  related(location, ownCaseId) {
    const incoming = { ...location, callback: this.callerNumber };
    const cases = relatedOpenCases(this.store, incoming, { exclude: [ownCaseId, ...this.ruledOut].filter(Boolean) });
    const ids = new Set(cases.map((c) => c.id));
    return cases.filter((c) => !ids.has(c.possibleDuplicateOf));
  }

  // The note for the agent's next turn, if any.
  note(location, ownCaseId) {
    this.#turn++;
    if (this.joined) {
      return (
        `CASE BOARD: the caller confirmed they are part of ${describe(this.store.get(this.joined), this.callerNumber)} ` +
        `Keep record.existing_case as id "${this.joined}", caller_confirmed "yes". ${ON_YES} ` +
        'Once you have asked about changes, close the call.'
      );
    }
    const cases = this.related(location ?? {}, ownCaseId).slice(0, MAX_LISTED);
    for (const c of cases) if (!this.#firstListed.has(c.id)) this.#firstListed.set(c.id, this.#turn);
    if (!cases.length) return undefined;
    const waiting = cases.find((c) => this.#asked.get(c.id) < this.#turn);
    if (waiting) {
      return (
        `CASE BOARD: you asked whether the caller is part of ${describe(waiting, this.callerNumber)} ` +
        `Set record.existing_case to id "${waiting.id}" with caller_confirmed "yes" or "no" from their answer ` +
        `("not_asked" while they have not answered), and do not ask about it again. If yes: ${ON_YES} ` +
        'If no: carry on collecting their own details.'
      );
    }
    if (this.#asked.size >= MAX_QUESTIONS) return undefined;
    return (
      'CASE BOARD: open rescue requests already reported near this caller:\n' +
      cases.map((c) => `- ${describe(c, this.callerNumber)}`).join('\n') +
      '\nIf the caller has already said whether they are one of these groups (for example "my brother called for us", or ' +
      '"those are our neighbours"), record that answer in record.existing_case instead of asking. Otherwise, if what they ' +
      'have said could fit one of these groups (same place, landmark or family), ask once whether they are part of it, ' +
      'describing it by place, landmark and number of people; never read out case numbers. Put that case in ' +
      'record.existing_case.id, with caller_confirmed "not_asked" until they answer. ' +
      'If none of them fits what the caller has said, ignore this note and leave existing_case.id empty.'
    );
  }

  // Call with the agent's record after each turn. Returns
  //   { join: id }     the caller confirmed they are part of that case
  //   { notSame: id }  the caller said they are not
  //   null             nothing to act on
  recorded(record) {
    const { id = '', caller_confirmed: answer = 'not_asked' } = record.existing_case ?? {};
    if (this.joined || !this.#firstListed.has(id)) return null;
    if (!this.#asked.has(id)) this.#asked.set(id, this.#turn);
    if (this.#firstListed.get(id) >= this.#turn) return null; // shown this turn: there is no answer yet
    if (answer === 'yes') {
      this.joined = id;
      return { join: id };
    }
    if (answer === 'no' && !this.ruledOut.includes(id)) {
      this.ruledOut.push(id);
      return { notSame: id };
    }
    return null;
  }

  // The case a human should compare this call with while it has not joined one: the case
  // the agent asked about, otherwise the closest related case.
  suspect(location, ownCaseId) {
    if (this.joined) return null;
    const related = this.related(location ?? {}, ownCaseId);
    return (related.find((c) => this.#asked.has(c.id)) ?? related[0])?.id ?? null;
  }
}

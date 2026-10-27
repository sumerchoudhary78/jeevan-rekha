import { suggestPlaces } from './gazetteer.mjs';

// What the server's gazetteer check says about the place the caller named (see suggestPlaces).
// Exact names need no question; a misheard one is confirmed once, by its known name.
function placeCheckNote({ level, candidates, heard }) {
  const [a, b] = candidates.map((c) => `${c.place}${c.native ? ` / ${c.native}` : ''} (${c.district} district)`);
  const intro = `PLACE CHECK from the rescue gazetteer. Speech recognition heard: "${heard}".`;
  if (level === 'exact') return `${intro} This names the known place ${a}. Record it with that spelling; no need to confirm it.`;
  if (level === 'likely') {
    return (
      `${intro} The closest known place is ${a}, but recognition garbles names on bad lines. ` +
      `Ask once to confirm it, saying the known name ${candidates[0].native ?? candidates[0].place}, not what recognition heard, ` +
      `e.g. "${candidates[0].native ?? candidates[0].place}, सही?". If they agree, record "${candidates[0].place}" and set location_confirmed. ` +
      'If they say no, record their own words, ask for a nearby landmark, and do not ask about the place name again.'
    );
  }
  return `${intro} It sounds like either ${a} or ${b}. Ask which one, naming both.`;
}

// Tracks the place a caller has named during one call: what to tell the agent each turn,
// and whether the place is confirmed. A misheard name is put to the caller at most once.
// Confirmation does not rely on the model's own flag alone: if, after being asked, the
// agent records the name it asked about, the caller agreed (on "no" it records their words).
export class PlaceCheck {
  confirmed = false;
  #pending = null; // the suggestion to put to the agent this turn
  #asked = null; // the place the caller was asked to confirm
  #questions = 0;

  constructor(districts) {
    this.districts = districts;
  }

  // Call with each finished caller utterance.
  heard(text) {
    if (this.confirmed) return;
    const found = suggestPlaces(text, this.districts);
    const canAsk = found.level === 'exact' || this.#questions === 0;
    if (found.level !== 'none' && canAsk) this.#pending = { ...found, heard: text }; // kept until the agent's turn
  }

  // The note for the agent's next turn, if any.
  note() {
    if (this.confirmed || !this.#pending) return undefined;
    if (this.#pending.level !== 'exact') {
      this.#questions++;
      this.#asked = this.#pending.candidates[0].place;
    }
    return placeCheckNote(this.#pending);
  }

  // Call with the agent's record after each turn.
  recorded(record, { askedThisTurn }) {
    const named = suggestPlaces(`${record.location.area}`, this.districts);
    const recordsAsked = named.level === 'exact' && named.candidates[0].place === this.#asked;
    this.confirmed ||=
      record.location_confirmed || this.#pending?.level === 'exact' || (!askedThisTurn && !!this.#asked && recordsAsked);
    this.#pending = null;
  }
}

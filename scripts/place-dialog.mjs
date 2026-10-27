// Checks how the call-taker handles misheard place names, with the same gazetteer check the
// live call uses (CallSession): it should confirm a garbled name once by its known spelling,
// not ask about exact names, and never swap an unknown village for a known one.
//   node --env-file=.env scripts/place-dialog.mjs [runs]
import { agentTurn, GREETINGS } from '../lib/agent.mjs';
import { gazetteer, norm } from '../lib/gazetteer.mjs';
import { PlaceCheck } from '../lib/place-check.mjs';

const SCENARIOS = [
  {
    name: 'garbled Hindi name, caller confirms',
    district: 'darbhanga',
    lines: ['हैलो, मैं बहड गांव से बोल रहा हूँ, पानी बहुत ऊपर है', 'हां, सही है'],
    asks: 'bahera',
    expect: { area: 'bahera', confirmed: true },
  },
  {
    name: 'garbled English name, caller confirms',
    district: 'patna',
    lines: ['Hello, I am calling from Tankarbagh sector three, the ground floor is flooded', 'Yes, that is right'],
    asks: 'kankarbagh',
    expect: { area: 'kankarbagh', confirmed: true },
  },
  {
    name: 'garbled name, caller says no',
    district: 'muzaffarpur',
    lines: ['मुजफ्फरपुर, औरई से बोल रहे हैं, छत पर हैं', 'नहीं नहीं, हम कटरिया गांव में हैं'],
    asks: 'aurai',
    expect: { notArea: 'aurai', confirmed: false },
  },
  {
    name: 'village not in the gazetteer',
    district: 'darbhanga',
    lines: ['हम सकरी गांव में फंसे हैं, पानी बढ़ रहा है'],
    asks: null,
    expect: { area: 'sakri', confirmed: false },
  },
  {
    name: 'exact known name, no extra question',
    district: 'darbhanga',
    lines: ['हम बहेड़ा गांव में फंसे हैं, शिव मंदिर के पीछे'],
    asks: null,
    expect: { area: 'bahera', confirmed: true },
  },
];

// The agent named the place if any known spelling of it is in what it said.
const names = (place) => {
  const p = Object.values(gazetteer).flatMap((d) => d.places).find((x) => norm(x.name).replace(/ /g, '') === place);
  return p && [p.name, ...p.aliases].map((a) => norm(a).replace(/ /g, ''));
};
const namesPlace = (text, place) => names(place).some((n) => norm(text).replace(/ /g, '').includes(n));
const asked = namesPlace;

async function run(s) {
  const history = [{ role: 'agent', text: GREETINGS['hi-IN'] }];
  const place = new PlaceCheck([s.district]);
  let askedPlace = false;
  let record;
  const says = [];
  for (const line of s.lines) {
    history.push({ role: 'caller', text: line });
    place.heard(line);
    const placeCheck = place.note();
    const turn = await agentTurn(history, { placeCheck });
    place.recorded(turn.record, { askedThisTurn: !!placeCheck });
    if (s.asks && asked(turn.say, s.asks)) askedPlace = true;
    history.push({ role: 'agent', text: turn.say });
    says.push(turn.say);
    record = turn.record;
  }
  const area = `${record.location.area} ${record.location.landmark}`;
  const checks = {
    asked: s.asks ? askedPlace : !says.some((t) => /sahi\s*\?|सही\s*(है)?\s*\?|right\s*\?/i.test(t) && /गांव|गाँव|village|place|जगह|बहेड़ा|bahera/i.test(t)),
    area: s.expect.area ? (names(s.expect.area) ? namesPlace(area, s.expect.area) : norm(area).includes(s.expect.area)) : !namesPlace(area, s.expect.notArea),
    confirmed: place.confirmed === s.expect.confirmed,
  };
  return { ok: Object.values(checks).every(Boolean), checks, says, record: `${record.location.area} / ${record.location.landmark}`, confirmed: place.confirmed };
}

const runs = Number(process.argv[2]) || 1;
let passed = 0;
for (let r = 0; r < runs; r++) {
  for (const s of SCENARIOS) {
    const res = await run(s);
    if (res.ok) passed++;
    const marks = Object.entries(res.checks).map(([k, v]) => `${k} ${v ? 'ok' : 'XX'}`).join('  ');
    console.log(`${res.ok ? 'PASS' : 'FAIL'}  ${s.name.padEnd(38)} ${marks}  -> ${res.record} confirmed=${res.confirmed}`);
    if (!res.ok) res.says.forEach((t) => console.log(`        agent: ${t}`));
  }
}
console.log(`\n${passed}/${runs * SCENARIOS.length} scenarios passed`);

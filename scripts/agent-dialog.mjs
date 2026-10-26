// Runs a scripted caller against the call-taker agent (text only) and prints each turn.
//   node --env-file=.env scripts/agent-dialog.mjs
import { agentTurn, GREETINGS } from '../lib/agent.mjs';

const callerLines = process.argv.length > 2 ? process.argv.slice(2) : [
  'हैलो, हम दरभंगा के बहेड़ा गांव में फंसे हैं, पानी बहुत बढ़ गया है',
  'शिव मंदिर के पीछे वाला घर है',
  'हम तीस लोग हैं छत पर',
  'हां, तीस, सही है। एक बूढ़ी अम्मा हैं जो चल नहीं सकतीं और दो छोटे बच्चे',
  'पानी पहली मंज़िल की खिड़की तक है',
];

const history = [{ role: 'agent', text: GREETINGS['hi-IN'] }];
console.log('AGENT :', GREETINGS['hi-IN']);
for (const line of callerLines) {
  history.push({ role: 'caller', text: line });
  console.log('CALLER:', line);
  const t0 = Date.now();
  const turn = await agentTurn(history, { callerNumber: '+91 98xxxxxx21' });
  history.push({ role: 'agent', text: turn.say });
  const r = turn.record;
  console.log(`AGENT : ${turn.say}   [${Date.now() - t0}ms, ${turn.say_lang}]`);
  console.log(`        ${r.location.area} / ${r.location.landmark} / ${r.location.district} | people ${r.headcount.min}-${r.headcount.max} confirmed=${r.headcount_confirmed} | ${r.vulnerable.join(',')} | water ${r.water_level} | ${r.urgency} | done=${turn.call_complete}`);
  if (turn.call_complete) break;
}

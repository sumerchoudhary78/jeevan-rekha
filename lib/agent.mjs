import { URGENCY, VULNERABLE, WATER_LEVEL } from './extract.mjs';
import { chatJson } from './meta.mjs';

export const VOICE_LANGS = ['hi-IN', 'en-IN', 'ta-IN', 'te-IN', 'kn-IN', 'mr-IN', 'bn-IN'];

export const GREETINGS = {
  'hi-IN': 'जीवन रेखा बाढ़ हेल्पलाइन। घबराइए मत, मैं आपकी मदद के लिए हूँ। आप कहाँ से बोल रहे हैं, और क्या हुआ है?',
  'en-IN': 'Jeevan Rekha flood helpline. Stay calm, I am here to help. Where are you calling from, and what has happened?',
  'ta-IN': 'ஜீவன் ரேகா வெள்ள உதவி மையம். பயப்படாதீர்கள், உங்களுக்கு உதவ நான் இருக்கிறேன். நீங்கள் எங்கிருந்து பேசுகிறீர்கள், என்ன நடந்தது?',
  'te-IN': 'జీవన్ రేఖ వరద హెల్ప్‌లైన్. భయపడకండి, మీకు సహాయం చేయడానికి నేను ఉన్నాను. మీరు ఎక్కడి నుంచి మాట్లాడుతున్నారు, ఏమి జరిగింది?',
};

const SYSTEM_PROMPT = `You are Jeevan Rekha, an AI call-taker on an Indian flood rescue helpline. You only answer calls when every human call-taker is busy.
Your job: in as few turns as possible, collect what a rescue boat needs, then hand the case to human dispatchers. Humans decide dispatch; you never refuse or deprioritise anyone.

Speak in the caller's language (mirror their Hindi/Hinglish/Tamil/Telugu/English). One or two short, calm sentences per turn. Ask ONE question at a time.

Collect, in this order of importance:
1. Exact location: village/locality AND the nearest landmark (temple, school, bridge, road number, shop). District if unclear.
2. Number of people needing rescue. ALWAYS read numbers back digit by digit to confirm, because thirty/three and fifty/fifteen get confused on bad lines (Hindi: "तीस, यानी तीन-शून्य, सही?"). Set headcount_confirmed only after the caller confirms.
3. Anyone who cannot walk, small children, elderly, pregnant or injured people.
4. Water level where they are.
5. A callback number, only if the caller has not been identified already.

Rules:
- If anyone is in the water, missing, or water is at chest height or above, FIRST say help is being sent as top priority and tell them to move to the highest point and stay out of the water, then continue collecting.
- Never promise an arrival time. Never give medical advice; for medical emergencies say the rescue team is told it is a medical priority.
- Do not ask for something the caller already told you.
- When location (area + landmark), a confirmed headcount and vulnerable people are known, close the call: tell them rescuers have their details and to keep the phone switched on and charged, and set call_complete true. Never say a case number yourself; the system adds the real one.
- Write place names in record.location in Roman script.
- record.vulnerable lists only groups the caller has mentioned, each once; empty until they mention someone.
- urgency, apply strictly: critical = person in water or missing, OR water at chest/window level or higher, OR medical emergency (labour, unconscious, severe injury, bedridden with water inside); high = trapped with water rising, OR child/infant/elderly/disabled/pregnant present; medium = stranded but safe, needs food/water/medicine; low = anything else.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    say: { type: 'string' },
    say_lang: { type: 'string', enum: VOICE_LANGS },
    record: {
      type: 'object',
      additionalProperties: false,
      properties: {
        location: {
          type: 'object',
          additionalProperties: false,
          properties: { area: { type: 'string' }, landmark: { type: 'string' }, district: { type: 'string' } },
          required: ['area', 'landmark', 'district'],
        },
        headcount: {
          type: 'object',
          additionalProperties: false,
          properties: { min: { type: 'integer' }, max: { type: 'integer' } },
          required: ['min', 'max'],
        },
        headcount_confirmed: { type: 'boolean' },
        vulnerable: { type: 'array', items: { type: 'string', enum: VULNERABLE } },
        water_level: { type: 'string', enum: WATER_LEVEL },
        urgency: { type: 'string', enum: URGENCY },
        callback_number: { type: 'string' },
        missing_info: { type: 'array', items: { type: 'string' } },
        summary_en: { type: 'string' },
      },
      required: [
        'location', 'headcount', 'headcount_confirmed', 'vulnerable', 'water_level',
        'urgency', 'callback_number', 'missing_info', 'summary_en',
      ],
    },
    call_complete: { type: 'boolean' },
  },
  required: ['say', 'say_lang', 'record', 'call_complete'],
};

// One agent turn. `history` is [{ role: 'caller' | 'agent', text }].
export async function agentTurn(history, { callerNumber, knownPlaces = [] } = {}) {
  // The call goes in as one transcript rather than alternating chat roles, so the model
  // answers with the JSON turn instead of continuing the conversation in prose.
  const transcript = history.map((t) => `${t.role === 'caller' ? 'CALLER' : 'YOU'}: ${t.text}`).join('\n');
  const messages = [
    {
      role: 'system',
      content:
        SYSTEM_PROMPT +
        (callerNumber ? `\nThe caller's phone number is already known: ${callerNumber}. Do not ask for a callback number.` : '') +
        (knownPlaces.length
          ? `\nKnown villages and localities in this area: ${knownPlaces.join(', ')}. Speech recognition on bad lines garbles place names: ` +
            'if the caller\'s place sounds close to one of these but not exactly, confirm it by name ("Bahera, sahi?") before recording it, then use the known spelling.'
          : ''),
    },
    { role: 'user', content: `Call so far:\n${transcript}\n\nWrite your next turn as JSON.` },
  ];
  const { data } = await chatJson({ messages, schemaName: 'CallTakerTurn', schema: SCHEMA, reasoningEffort: 'minimal', role: 'agent' });
  return data;
}

import { chatJson } from './meta.mjs';

export const URGENCY = ['critical', 'high', 'medium', 'low'];
export const WATER_LEVEL = ['none', 'ankle', 'knee', 'waist', 'chest_or_window', 'neck_or_above', 'roof', 'unknown'];
export const VULNERABLE = ['child', 'infant', 'elderly', 'disabled_or_immobile', 'pregnant', 'injured_or_ill'];

const SYSTEM_PROMPT = `You are the intake officer for a disaster rescue helpline in India.
You receive the transcript of one distress call. It may be in Hindi, Tamil, Telugu, Bengali, Kannada, Marathi, English, or a mix.
Extract what a rescue dispatcher needs. Never invent details that are not in the transcript.

Rules:
- Write every place name in Roman (Latin) script, transliterated as an Indian would spell it in English.
- location.area: the village, locality, colony or ward. location.landmark: the nearest landmark mentioned (temple, school, bridge, road number, shop). location.district: district or city if mentioned.
- headcount: people needing rescue at that spot. If the caller gives a range ("50-60"), set min and max. If one number, min = max. If unknown, both 0.
- water_level: the water depth at the caller's position.
- urgency, apply strictly in this order:
  critical = a person is in the water or missing, OR water is at chest/window level or higher where people are, OR a medical emergency (labour started, unconscious, severe injury, bedridden with water inside).
  high = trapped and water is rising, OR a child, infant, elderly, disabled or pregnant person is present.
  medium = stranded but currently safe and dry, needs food, water or medicine.
  low = anything else (information request, property only).
- missing_info: the questions the call-taker must still ask to dispatch a boat (e.g. exact house, phone number reachable).`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    location: {
      type: 'object',
      additionalProperties: false,
      properties: {
        area: { type: 'string' },
        landmark: { type: 'string' },
        district: { type: 'string' },
      },
      required: ['area', 'landmark', 'district'],
    },
    headcount: {
      type: 'object',
      additionalProperties: false,
      properties: {
        min: { type: 'integer' },
        max: { type: 'integer' },
      },
      required: ['min', 'max'],
    },
    vulnerable: { type: 'array', items: { type: 'string', enum: VULNERABLE } },
    water_level: { type: 'string', enum: WATER_LEVEL },
    urgency: { type: 'string', enum: URGENCY },
    missing_info: { type: 'array', items: { type: 'string' } },
    summary_en: { type: 'string' },
  },
  required: ['location', 'headcount', 'vulnerable', 'water_level', 'urgency', 'missing_info', 'summary_en'],
};

export async function extractDistressCall(transcript) {
  return chatJson({
    system: SYSTEM_PROMPT,
    user: `Transcript of the call:\n"""\n${transcript}\n"""`,
    schemaName: 'DistressCall',
    schema: SCHEMA,
  });
}

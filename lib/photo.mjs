import { VULNERABLE, WATER_LEVEL } from './extract.mjs';
import { chatJson } from './meta.mjs';

const MODEL_API_BASE = process.env.MODEL_API_BASE ?? 'https://api.meta.ai/v1';

// SAM 3.1 concept segmentation: every "person" in the photo, as boxes in source pixels.
export async function segmentPeople(imageDataUrl) {
  const res = await fetch(`${MODEL_API_BASE}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MODEL_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: 'sam-3.1',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'person' },
            { type: 'input_image', image_url: imageDataUrl },
          ],
        },
      ],
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`SAM 3.1 failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);

  let text = '';
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === 'response.output_text.delta') text += event.delta;
    }
  }

  const boxes = [...text.matchAll(/(\d+)<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)/g)].map((m) => {
    const [, id, x1, y1, x2, y2, w, h] = m.map(Number);
    return { id, x1, y1, x2, y2, w, h };
  });
  return { count: boxes.length, boxes };
}

const SCENE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    water_level: { type: 'string', enum: WATER_LEVEL },
    people_visible: { type: 'integer' },
    vulnerable_visible: { type: 'array', items: { type: 'string', enum: VULNERABLE } },
    stranded_on: { type: 'string', description: 'roof, upper floor, tree, boat, island, unknown' },
    rescue_notes: { type: 'string', description: 'One sentence a boat crew needs: approach, hazards, landmarks visible' },
  },
  required: ['water_level', 'people_visible', 'vulnerable_visible', 'stranded_on', 'rescue_notes'],
};

// Muse Spark reads the scene: water depth relative to the people, who looks vulnerable,
// and what a boat crew should know.
export async function assessScene(imageDataUrl) {
  const { data } = await chatJson({
    messages: [
      {
        role: 'system',
        content:
          'You assess photos sent by people stranded in floods for a rescue control room. Describe only what is visible. ' +
          'water_level is the depth where the people are standing or sitting relative to their bodies or the building ' +
          '(roof = water at or near the roof they are on). Never give medical advice.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Assess this photo from a stranded caller.' },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    schemaName: 'FloodScene',
    schema: SCENE_SCHEMA,
    reasoningEffort: 'low',
  });
  return data;
}

export async function analysePhoto(imageDataUrl) {
  const [people, scene] = await Promise.all([segmentPeople(imageDataUrl), assessScene(imageDataUrl)]);
  return { people, scene };
}

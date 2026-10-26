import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const MODEL_API_BASE = process.env.MODEL_API_BASE ?? 'https://api.meta.ai/v1';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (copy .env.example to .env)`);
  return value;
}

async function failOnHttpError(res, what) {
  if (res.ok) return;
  const body = await res.text();
  throw new Error(`${what} failed: HTTP ${res.status} ${body.slice(0, 500)}`);
}

// POST /asr/transcribe with a 16-bit mono WAV (<= 10 min, <= 32 MB).
export async function transcribe(wavPath, { languageBias, keywords } = {}) {
  const request = {
    model: 'muse-voice-transcribe-1.0',
    audioEncoding: 'WAV',
    mode: 'PUSH_TO_TALK',
    ...(languageBias?.length && { languageBias }),
    ...(keywords?.length && { keywords }),
  };

  const form = new FormData();
  form.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }));
  form.append('audio', new Blob([await readFile(wavPath)], { type: 'audio/wav' }), basename(wavPath));

  const res = await fetch(`${MODEL_API_BASE}/asr/transcribe`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireEnv('MODEL_API_KEY')}`,
      Accept: 'application/json',
    },
    body: form,
  });
  await failOnHttpError(res, 'transcribe');
  const raw = await res.json();
  return { text: transcriptText(raw), raw };
}

// The buffered response carries either a single transcript or a list of turns.
function transcriptText(raw) {
  if (typeof raw.transcript === 'string') return raw.transcript;
  if (Array.isArray(raw.turns)) {
    return raw.turns.map((t) => t.transcript ?? t.text ?? '').join(' ').trim();
  }
  return '';
}

// OpenAI-compatible chat completion with a strict JSON schema response.
// role 'agent' (the live conversation) can run on a different model than triage work
// (extraction, duplicate judgement, photo reading) via AGENT_LLM_* overrides.
function llmConfig(role) {
  const env = (name) => (role === 'agent' && process.env[`AGENT_${name}`]) || process.env[name];
  return {
    baseUrl: env('LLM_BASE_URL') ?? MODEL_API_BASE,
    apiKey: env('LLM_API_KEY') || requireEnv('MODEL_API_KEY'),
    model: env('LLM_MODEL') ?? 'muse-spark-1.3',
  };
}

export async function chatJson({ system, user, messages, schemaName, schema, reasoningEffort, role }) {
  const { baseUrl, apiKey, model } = llmConfig(role);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: messages ?? [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, schema, strict: true },
      },
    }),
  });
  await failOnHttpError(res, 'chat completion');
  const body = await res.json();
  return { model, data: parseJsonContent(body.choices[0].message.content) };
}

// Structured output is occasionally wrapped in stray prose or a code fence; take the outermost object.
function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error(`model returned no JSON: ${content.slice(0, 200)}`);
    return JSON.parse(content.slice(start, end + 1));
  }
}

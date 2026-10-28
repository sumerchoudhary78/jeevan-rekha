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
  throw Object.assign(new Error(`${what} failed: HTTP ${res.status} ${body.slice(0, 500)}`), { status: res.status });
}

// A request that hangs would stall a call or the flood-night replay for good, so every model
// request has a deadline, and one that times out or meets a server error is tried once more.
const TIMEOUT_MS = 60000;
async function withRetry(what, request) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await request(AbortSignal.timeout(TIMEOUT_MS));
      await failOnHttpError(res, what);
      return res;
    } catch (err) {
      const retryable = !err.status || err.status === 429 || err.status >= 500;
      if (attempt === 1 || !retryable) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
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

  const audio = await readFile(wavPath);
  const res = await withRetry('transcribe', (signal) => {
    const form = new FormData();
    form.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }));
    form.append('audio', new Blob([audio], { type: 'audio/wav' }), basename(wavPath));
    return fetch(`${MODEL_API_BASE}/asr/transcribe`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireEnv('MODEL_API_KEY')}`,
        Accept: 'application/json',
      },
      body: form,
      signal,
    });
  });
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
  const prefix = role === 'agent' && process.env.AGENT_LLM_BASE_URL ? 'AGENT_' : '';
  const env = (name) => process.env[`${prefix}${name}`] || undefined;
  return {
    baseUrl: env('LLM_BASE_URL') ?? MODEL_API_BASE,
    // An empty key means the Meta Model API key, separately for each role.
    apiKey: env('LLM_API_KEY') || requireEnv('MODEL_API_KEY'),
    model: env('LLM_MODEL') ?? 'muse-spark-1.3',
  };
}

// Which model serves each role, for display; never includes keys.
export function modelsInUse() {
  const show = (role) => {
    const { baseUrl, model } = llmConfig(role);
    return { model, host: new URL(baseUrl).hostname };
  };
  return { conversation: show('agent'), triage: show('triage') };
}

export async function chatJson({ system, user, messages, schemaName, schema, reasoningEffort, role }) {
  const { baseUrl, apiKey, model } = llmConfig(role);

  const body = JSON.stringify({
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
  });
  // A reply that is not valid JSON (it happens, even with a strict schema) is asked for once more.
  for (let attempt = 0; ; attempt++) {
    const res = await withRetry('chat completion', (signal) =>
      fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal,
      }),
    );
    const completion = await res.json();
    try {
      return { model, data: parseJsonContent(completion.choices[0].message.content) };
    } catch (err) {
      if (attempt === 1) throw err;
    }
  }
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

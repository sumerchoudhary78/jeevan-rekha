// ElevenLabs is used only for spoken agent replies. Caller transcription stays on Meta.
const MAX_TEXT_LENGTH = 2000;
const LANGUAGES = new Set(['hi', 'en', 'ta', 'te', 'kn', 'mr', 'bn']);

export function speechConfig() {
  return {
    provider: process.env.ELEVENLABS_API_KEY?.trim() ? 'elevenlabs' : 'browser',
    model: process.env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_v3',
    voiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || 'JBFqnCBsd6RMkjVDRZzb',
  };
}

const fail = (status, message) => Object.assign(new Error(message), { status });

export async function synthesiseSpeech(input, { signal } = {}) {
  const { text, lang } = input ?? {};
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_LENGTH) {
    throw fail(400, `Speech text must contain 1–${MAX_TEXT_LENGTH} characters.`);
  }
  const language = typeof lang === 'string' ? lang.split('-')[0] : '';
  if (!LANGUAGES.has(language)) throw fail(400, 'Unsupported speech language.');

  const config = speechConfig();
  if (config.provider !== 'elevenlabs') throw fail(503, 'ElevenLabs voice is not configured.');
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}`);
  url.searchParams.set('output_format', 'mp3_44100_128');
  const deadline = AbortSignal.timeout(20000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    // Do not retry paid generations automatically: a failed response may already have
    // consumed credits. The caller can continue with the device voice instead.
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY.trim(),
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: config.model,
        ...(config.model !== 'eleven_multilingual_v2' && { language_code: language }),
      }),
      signal: requestSignal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      // Provider error bodies can contain request data. Return only a safe description.
      throw fail(502, `ElevenLabs could not generate speech (HTTP ${response.status}).`);
    }
    if (!response.headers.get('content-type')?.startsWith('audio/')) {
      await response.body?.cancel();
      throw fail(502, 'ElevenLabs returned an invalid audio response.');
    }
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length) throw fail(502, 'ElevenLabs returned empty audio.');
    return audio;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (deadline.aborted) throw fail(504, 'ElevenLabs speech generation timed out.');
    if (error.status) throw error;
    throw fail(502, 'ElevenLabs voice is temporarily unavailable.');
  }
}

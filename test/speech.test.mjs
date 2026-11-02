import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { speechConfig, synthesiseSpeech } from '../lib/speech.mjs';

const names = ['ELEVENLABS_API_KEY', 'ELEVENLABS_MODEL_ID', 'ELEVENLABS_VOICE_ID'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
});
afterEach(() => {
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

test('speech config is safe to send to the browser and needs only the API key', () => {
  assert.equal(speechConfig().provider, 'browser');
  process.env.ELEVENLABS_API_KEY = 'private-test-key';
  assert.deepEqual(speechConfig(), { provider: 'elevenlabs', model: 'eleven_v3', voiceId: 'JBFqnCBsd6RMkjVDRZzb' });
  assert.ok(!JSON.stringify(speechConfig()).includes('private-test-key'));
});

test('speech input is bounded and validated before any paid request', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not request speech'); });
  for (const input of [null, {}, [], { text: '', lang: 'hi-IN' }, { text: '  ', lang: 'hi-IN' },
    { text: 'a'.repeat(2001), lang: 'en-IN' }, { text: 'Hello', lang: 'zz-ZZ' }, { text: 42, lang: 'en-IN' }]) {
    await assert.rejects(synthesiseSpeech(input), { status: 400 });
  }
  await assert.rejects(synthesiseSpeech({ text: 'Hello', lang: 'en-IN' }), { status: 503 });
  assert.equal(request.mock.callCount(), 0);
});

test('speech sends the configured key, voice and model only to ElevenLabs and maps the language', async (t) => {
  process.env.ELEVENLABS_API_KEY = 'private-test-key';
  process.env.ELEVENLABS_VOICE_ID = 'custom/voice';
  process.env.ELEVENLABS_MODEL_ID = 'eleven_v3';
  const audio = Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } });
  });
  for (const lang of ['hi-IN', 'en-IN', 'ta-IN', 'te-IN', 'kn-IN', 'mr-IN', 'bn-IN']) {
    assert.deepEqual(await synthesiseSpeech({ text: '  आपका केस नंबर तीस है।  ', lang }), audio);
    const { url, options } = requests.at(-1);
    assert.equal(url.origin, 'https://api.elevenlabs.io');
    assert.equal(url.pathname, '/v1/text-to-speech/custom%2Fvoice');
    assert.equal(url.searchParams.get('output_format'), 'mp3_44100_128');
    assert.equal(options.headers['xi-api-key'], 'private-test-key');
    assert.deepEqual(JSON.parse(options.body), { text: 'आपका केस नंबर तीस है।', model_id: 'eleven_v3', language_code: lang.slice(0, 2) });
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('Multilingual v2 override omits the unsupported language_code parameter', async (t) => {
  process.env.ELEVENLABS_API_KEY = 'test-key';
  process.env.ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
  const request = t.mock.method(globalThis, 'fetch', async () => new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } }));
  await synthesiseSpeech({ text: 'Hello', lang: 'en-IN' });
  assert.equal('language_code' in JSON.parse(request.mock.calls[0].arguments[1].body), false);
});

test('provider failures do not leak error bodies or retry a paid generation', async (t) => {
  process.env.ELEVENLABS_API_KEY = 'test-key';
  const request = t.mock.method(globalThis, 'fetch', async () => new Response('secret provider response', { status: 401 }));
  await assert.rejects(synthesiseSpeech({ text: 'Hello', lang: 'en-IN' }), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.message.includes('secret provider response'), false);
    return true;
  });
  assert.equal(request.mock.callCount(), 1);
});

test('non-audio and empty provider responses fail safely', async (t) => {
  process.env.ELEVENLABS_API_KEY = 'test-key';
  const request = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(synthesiseSpeech({ text: 'Hello', lang: 'en-IN' }), { status: 502 });
  request.mock.mockImplementation(async () => new Response('', { headers: { 'Content-Type': 'audio/mpeg' } }));
  await assert.rejects(synthesiseSpeech({ text: 'Hello', lang: 'en-IN' }), { status: 502 });
});

test('cancelling a disconnected caller also cancels its provider request', async (t) => {
  process.env.ELEVENLABS_API_KEY = 'test-key';
  const controller = new AbortController();
  let upstreamSignal;
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    upstreamSignal = signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const pending = synthesiseSpeech({ text: 'Hello', lang: 'en-IN' }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(upstreamSignal.aborted, true);
});

test('a provider deadline becomes a safe gateway timeout', async (t) => {
  process.env.ELEVENLABS_API_KEY = 'test-key';
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => controller.signal);
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const pending = synthesiseSpeech({ text: 'Hello', lang: 'en-IN' });
  controller.abort(new DOMException('timeout', 'TimeoutError'));
  await assert.rejects(pending, { status: 504 });
});

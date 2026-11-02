import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpeechPlayer } from '../public/speech.js';

function globalValue(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

function deviceVoice(t, { autoEnd = true } = {}) {
  const utterances = [];
  const synthesis = {
    cancellations: 0,
    getVoices: () => [{ lang: 'hi-IN', name: 'Hindi test voice' }],
    speak: (utterance) => {
      utterances.push(utterance);
      if (autoEnd) queueMicrotask(() => utterance.onend?.());
    },
    cancel: () => { synthesis.cancellations++; },
  };
  globalValue(t, 'speechSynthesis', synthesis);
  globalValue(t, 'SpeechSynthesisUtterance', class { constructor(text) { this.text = text; } });
  return { synthesis, utterances };
}

function audioContext({ autoEnd = true } = {}) {
  const sources = [];
  return {
    state: 'running', destination: {}, sources,
    decodeAudioData: async () => ({ duration: 0.01 }),
    createBufferSource: () => {
      const source = {
        started: false, stopped: false, disconnected: false,
        connect() {},
        disconnect() { this.disconnected = true; },
        start() { this.started = true; if (autoEnd) queueMicrotask(() => this.onended?.()); },
        stop() { this.stopped = true; },
      };
      sources.push(source);
      return source;
    },
  };
}

test('ElevenLabs replies play through the call AudioContext without a key in the browser request', async (t) => {
  const context = audioContext();
  const { utterances } = deviceVoice(t);
  const request = t.mock.method(globalThis, 'fetch', async () => new Response('mp3', { headers: { 'Content-Type': 'audio/mpeg' } }));
  const player = new SpeechPlayer({ audioContext: context, provider: 'elevenlabs' });
  assert.equal(await player.speak('हम आपकी मदद करेंगे।', 'hi-IN'), true);
  const [url, options] = request.mock.calls[0].arguments;
  assert.equal(url, '/api/speech');
  assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(options.body), { text: 'हम आपकी मदद करेंगे।', lang: 'hi-IN' });
  assert.equal(context.sources[0].started, true);
  assert.equal(context.sources[0].disconnected, true);
  assert.equal(utterances.length, 0);
});

test('missing server configuration uses the caller language and never requests ElevenLabs', async (t) => {
  const { utterances } = deviceVoice(t);
  const request = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected network request'); });
  const player = new SpeechPlayer({ audioContext: audioContext() });
  assert.equal(await player.speak('नमस्ते', 'hi-IN'), true);
  assert.equal(utterances[0].lang, 'hi-IN');
  assert.equal(utterances[0].voice.name, 'Hindi test voice');
  assert.equal(request.mock.callCount(), 0);
});

test('provider failure falls back for the rest of this call and gives one notice', async (t) => {
  const { utterances } = deviceVoice(t);
  const request = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 502 }));
  let notices = 0;
  const player = new SpeechPlayer({ audioContext: audioContext(), provider: 'elevenlabs', onFallback: () => notices++ });
  assert.equal(await player.speak('First reply', 'en-IN'), true);
  assert.equal(await player.speak('Second reply', 'en-IN'), true);
  assert.equal(request.mock.callCount(), 1);
  assert.equal(notices, 1);
  assert.equal(utterances.length, 2);
});

test('undecodable provider audio also falls back without leaving the call stuck', async (t) => {
  const { utterances } = deviceVoice(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('bad mp3'));
  const context = audioContext();
  context.decodeAudioData = async () => { throw new Error('bad audio'); };
  const player = new SpeechPlayer({ audioContext: context, provider: 'elevenlabs' });
  assert.equal(await player.speak('Hello', 'en-IN'), true);
  assert.equal(utterances.length, 1);
});

test('hanging up during synthesis cancels the request and does not start a fallback voice', async (t) => {
  const { utterances } = deviceVoice(t);
  let requestSignal;
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    requestSignal = signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const context = audioContext();
  const player = new SpeechPlayer({ audioContext: context, provider: 'elevenlabs' });
  const pending = player.speak('Hello', 'en-IN');
  player.cancel();
  assert.equal(await pending, false);
  assert.equal(requestSignal.aborted, true);
  assert.equal(context.sources.length, 0);
  assert.equal(utterances.length, 0);
});

test('hanging up while audio is decoding prevents late playback in a new call', async (t) => {
  const { utterances } = deviceVoice(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('mp3'));
  const context = audioContext();
  let release;
  const decoding = new Promise((resolve) => {
    context.decodeAudioData = () => { resolve(); return new Promise((done) => { release = done; }); };
  });
  const player = new SpeechPlayer({ audioContext: context, provider: 'elevenlabs' });
  const pending = player.speak('Hello', 'en-IN');
  await decoding;
  player.cancel();
  release({ duration: 0.01 });
  assert.equal(await pending, false);
  assert.equal(context.sources.length, 0);
  assert.equal(utterances.length, 0);
});

test('hanging up stops active ElevenLabs playback and settles the pending reply', async (t) => {
  deviceVoice(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('mp3'));
  const context = audioContext({ autoEnd: false });
  let started;
  const playing = new Promise((resolve) => { started = resolve; });
  const originalCreate = context.createBufferSource;
  context.createBufferSource = () => {
    const source = originalCreate();
    source.start = () => { source.started = true; started(); };
    return source;
  };
  const player = new SpeechPlayer({ audioContext: context, provider: 'elevenlabs' });
  const pending = player.speak('Hello', 'en-IN');
  await playing;
  player.cancel();
  assert.equal(await pending, false);
  assert.equal(context.sources[0].stopped, true);
  assert.equal(context.sources[0].disconnected, true);
});

test('hanging up also stops and settles a device-voice fallback', async (t) => {
  const { synthesis } = deviceVoice(t, { autoEnd: false });
  const player = new SpeechPlayer({ audioContext: audioContext() });
  const pending = player.speak('Hello', 'en-IN');
  player.cancel();
  assert.equal(await pending, false);
  assert.equal(synthesis.cancellations, 1);
});

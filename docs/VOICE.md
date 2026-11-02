# Agent voice

Agent replies use ElevenLabs when `ELEVENLABS_API_KEY` is set on the server.
Caller audio still goes to Meta Muse Voice Transcribe, and Muse Spark still writes
the agent's replies. Without the ElevenLabs key, replies use the device voice.

Add these to your local, ignored `.env`, then restart `npm start` and reload `/caller`:

```dotenv
ELEVENLABS_API_KEY=your_api_key
ELEVENLABS_MODEL_ID=eleven_v3
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
```

Only the API key is required. The model and stock George voice shown above are the
defaults. Replace the voice ID with a voice available to your ElevenLabs account.
The default v3 model covers Hindi, English, Tamil and Telugu; Multilingual v2 and
Flash v2.5 do not support Telugu. See the [ElevenLabs model language lists](https://elevenlabs.io/docs/overview/models)
and [speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).

The server generates one MP3 per reply, and the caller plays it through the same
AudioContext used for the turn tone. The microphone stays muted while generating
and playing audio. Replies play in order. Hanging up cancels generation and stops
playback. After a provider, quota or audio error, that call uses the device voice
and shows a short notice; the next call tries ElevenLabs again.

## HTTP contract

Both routes use the existing demo passcode/cookie gate.

- `GET /api/config` adds `speech: { provider, model, voiceId }`. `provider` is
  `elevenlabs` when the server key is present, otherwise `browser`. No key is sent
  to the client.
- `POST /api/speech`, JSON `{ "text": "Where are you calling from?", "lang": "en-IN" }`,
  returns `200 audio/mpeg` with `Cache-Control: no-store`. The server supplies the
  API key, model and voice; the client cannot override them.
- `text` must be nonblank and at most 2,000 characters. `lang` accepts the agent's
  language codes: `hi-IN`, `en-IN`, `ta-IN`, `te-IN`, `kn-IN`, `mr-IN`, `bn-IN`
  (or their two-letter forms). Request bodies are limited to 16 KiB.
- Errors are JSON `{ "error": "..." }`: `400` invalid input, `401` missing demo
  access, `413` oversized body, `429` four speech requests already in progress,
  `503` missing server key, `502` provider failure or invalid audio, `504` generation
  exceeded 20 seconds. Provider error bodies are never forwarded. Paid generations
  are not retried automatically.

Audio is buffered for each short reply before playback. This adds a synthesis
round trip; first-audio latency and pronunciation need checking with the real key.

## Modal deployment

Modal does not read the local `.env`. Add `ELEVENLABS_API_KEY`, and any model/voice
overrides, to the existing `jeevan-rekha-meta` Modal secret alongside its current
values, then redeploy with `modal deploy deploy/modal_app.py`. The deployment
already excludes `.env` from the image. Do not commit the API key or include it
in a submission link.

# Jeevan Rekha

An AI surge call-taker for disaster helplines. When every human call-taker is busy during a flood, overflow calls go to an agent that listens in the caller's language, extracts what a rescue boat needs (location, headcount, vulnerable people, water level, urgency), merges duplicate reports and hands a ranked queue to human dispatchers. The agent never decides that someone will not be rescued: it collects and ranks, people dispatch.

Built on Meta models: Muse Voice Transcribe for multilingual speech recognition with gazetteer keyword biasing, and Muse Spark (hosted, or the open-weight Muse Spark Open) for extraction and triage.

Languages covered by Muse Voice Transcribe that matter here: Hindi, Bengali, Marathi, Tamil, Telugu, Kannada, English, with code-switching.

## Setup

Requires Node 22+ and, for generating test audio, macOS `say` and `ffmpeg`.

```sh
cp .env.example .env   # add MODEL_API_KEY from dev.meta.ai -> API keys
```

The Meta Model API rejects requests until a payment method is on file, even with free credits.

## Day-1 feasibility test

Ten scripted distress calls (Hindi, Hindi-English code-switched, Tamil, Telugu) with ground-truth labels in `day1/cases.json`.

```sh
npm run day1:audio        # synthesize clean + phone-band noisy WAVs into day1/audio/
npm run day1:test         # clean audio, biased vs unbiased transcription
npm run day1:test:noisy   # phone-band + background noise
node --env-file=.env day1/run.mjs --set /path/to/real-recordings   # <case-id>.wav files
```

Pass bar: at least 8 of 10 calls with correct location, headcount and urgency on the biased run.

Synthetic TTS audio is far cleaner than a real panicked caller. Passing it is necessary, not sufficient: re-run on real recordings (fast speech, background noise, phone mic) before trusting the result.

To run the extraction step on open weights, point `LLM_BASE_URL` / `LLM_MODEL` at Muse Spark Open on Baseten (see `.env.example`).

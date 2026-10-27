# Jeevan Rekha

**When the flood helpline is full, nobody should get a busy tone.**

Jeevan Rekha ("lifeline") is an AI surge call-taker for disaster helplines in India. When every human call-taker is busy, overflow calls go to an agent that:
- listens in the caller's language
- asks only what a rescue boat needs
- reads numbers back so "thirty" never becomes "three"
- merges duplicate reports
- hands human dispatchers a ranked rescue queue on a map

Callers can also send a photo: SAM 3.1 counts the people on the roof and Muse Spark reads the water level.

> In July 2026, Assam flood survivors said *most helplines were unreachable*. In Kerala's 2018 floods, officials had to go on air asking callers for their exact location, landmarks and the number of people stranded. Disaster lines are staffed for ordinary days; in a flood they become the bottleneck.

The AI never decides that someone will not be rescued. It collects, confirms and ranks; **humans dispatch**.

**Live demo:** https://sumerchoudhary78--jeevan-rekha-web.us-east.modal.run (append `?code=<passcode>`; the passcode is in the submission form so the Meta API credits aren't open to everyone). Pages: `/caller` and `/control`.

Built for the Meta Global AI Developer Hackathon 2026 (Indie track, *Build for Your World*). Everything in this repository was built during the hackathon.

---

## What it does

| | |
|---|---|
| **Live AI call-taker** | Browser phone streams 24 kHz audio to Muse Voice Transcribe (realtime, endpointing). Muse Spark runs each turn: one question at a time, in the caller's language, safety instructions first when water is chest-high, confirms garbled place names against the district gazetteer, reads headcounts back digit by digit, closes with a real case number. |
| **Case intake & triage** | Every report becomes a case with location (geocoded), headcount, vulnerable people, water level and urgency. Priority = urgency + vulnerable people + headcount + waiting time, so nobody starves in the queue. Missing facts raise a **needs callback** flag; they never lower urgency. |
| **Duplicate merging** | Muse Spark judges each new report against nearby open cases: *same group* (merge), *same pickup point* (merge, headcount becomes a range so the boat is never too small), *possible duplicate* (kept separate and flagged for a human), or *different*. Merges only ever raise urgency and headcount. |
| **Photo evidence** | SAM 3.1 segments every person in the caller's photo; Muse Spark reads water level, visible vulnerable people and boat-approach notes. People counted become a floor on the headcount. |
| **Control room** | Live AI calls, a Leaflet/OpenStreetMap map, and the ranked rescue queue with transcripts, merge badges, photo overlays, assign/rescued actions. |
| **Flood-night simulator** | Replays 24 overlapping phone-quality calls (Hindi, English, Tamil, Telugu) including relatives and neighbours reporting the same rooftops. |

## Meta models

| Model | Used for |
|---|---|
| **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`) | Realtime WebSocket transcription with endpointing for live calls; file transcription for recorded calls. **Keyword biasing** with each district's villages, localities and landmarks (Roman and native script), plus language biasing. |
| **Muse Spark** (`muse-spark-1.3`) | The live call-taker agent (`reasoning_effort: minimal`, ~2.5 s per turn, strict JSON schema). |
| **Muse Spark Open** (`meta-models/muse-spark-open-1026`, open weights on Baseten) | **Default for all triage:** structured extraction, the duplicate judge, and photo scene reading (vision). Same code path, switched by `LLM_*` env vars. |
| **SAM 3.1** (`sam-3.1`) | Concept segmentation (`"person"`) on caller photos via the Responses API; boxes drawn in the control room. |
| **Muse Image** (`muse-image-1.0`) | Generated the synthetic demo rooftop photo (`data/photos/`), so no real victim's image is used. |
| **Muse Glimmer 30B** (optional, self-hosted) | `deploy/modal_glimmer_gguf.py` (Meta's Q4_K_M GGUF on one L4 via llama.cpp) and `deploy/modal_glimmer.py` (BF16 on an H100 via vLLM). Not run: Modal requires a payment method for GPUs. |

## Results

All numbers come from the scripts in this repo, run against the live Meta Model API. The audio is **synthetic** (macOS TTS voices); real panicked callers are harder.

**Day-1 extraction test** (`npm run day1:test`, 10 labelled calls: Hindi, Hindi-English code-switched, Tamil, Telugu). "Correct" means location, headcount and urgency all match.

| Audio | Gazetteer keyword biasing | Without biasing |
|---|---|---|
| Clean, 2 runs | 18/20 calls correct | 18/20 |
| Phone-band + background noise, 2 runs | **19/20 calls, 20/20 locations** | 15/20 calls, 16/20 locations |

Urgency was correct in every run. Without biasing, noisy audio turned *Kankarbagh* into "tanker" and *Danapur Diara* into "Daynapar, 11 area, 12 area". In one noisy run *तीस* (30) was heard as *तीन* (3). That is the mishearing the live agent's digit-by-digit read-back exists to catch.

**Flood-night surge** (`npm run surge:eval`, 24 calls, 19 distinct incidents, 5 with duplicate reports); identical outcome in the last 2 runs:

- **0 wrong merges.**
- 4 of 5 duplicate groups merged automatically, including a Hindi call and an English call from a relative about the same school roof.
- The 5th, a garbled third-party call ("second temple" for "Shiv temple"), was flagged **possible duplicate** for a human instead of being merged.
- A same-village, different-house report stayed separate.
- 24 calls are processed in about 90 s with 4 concurrent workers.

**Open weights: Muse Spark Open on Baseten** (same scripts, triage switched by env vars; ASR is still Muse Voice Transcribe). Keyword-biased results, 2 runs each, with the closed model re-run once on the same prompt:

| | Muse Spark Open (open weights) | Muse Spark 1.3 (hosted) |
|---|---|---|
| Day-1 noisy audio | **19/20** calls correct | 9/10 |
| Day-1 clean audio | 17/20 | 9/10 |
| Flood night, wrong merges | **0** in both runs | 0 |
| Flood night, duplicate groups | run 1: 4/5 merged + 1 flagged (same as hosted); run 2: 4/5 merged, 1 split when ASR heard *Bahera* as "Bahad" | 4/5 merged + 1 flagged |
| Photo scene (vision) | 8 people, water at roof, approach notes (~10 s with SAM in parallel) | 8 people, water at roof (~5.5 s) |

Almost every remaining miss is an ASR mishearing shared by both models ("Tankarbagh", "diarrhea area" for *Diara area*). The first open-weights run surfaced one real problem: the model tagged vulnerable groups nobody mentioned (all five on a "we are safe, need medicine" call) and repeated tags. An explicit prompt rule plus de-duplication fixed it, and the numbers above are after that fix. The live conversation stays on hosted Muse Spark: on open weights it asked the same questions correctly, but turns took 2–5 s with one 12.7 s outlier, too slow for a phone call.

**Misheard place names** (`npm run place:eval`, no API calls): the matcher is replayed over all 233 distinct real transcripts the day-1 runs produced (clean and noisy, with and without biasing), plus 30 lines naming places that are *not* in the gazetteer, including near-misses such as *Basantpatti*, *Benipatti* and *Gaighati*.

| | Spelling-only matcher (before) | Sound-key matcher (after) |
|---|---|---|
| Place found in the raw transcript | 200/233 | **217/233** (179 exact, 38 to confirm with the caller) |
| Place found in the extracted area | 218/233 | **223/233** |
| Wrong place | 0 | 0 |
| Not-in-gazetteer lines rejected | 29/30 (the other was silently placed) | 29/30 (the other triggers a confirmation question) |

The sound key folds consonants into classes across Devanagari and Latin (aspirated = plain, retroflex = dental, vowels dropped), and Devanagari is also compared with its vowel signs stripped. That catches *बहड* → Bahera, *Tankarbagh* → Kankarbagh and *औरई* → Aurai, without letting *Bahad* match Bahadurpur. The 0.84 threshold was chosen on this same data, so these are not held-out numbers. What's left is mostly unrecoverable from text: *Aurai* split into "और आई" ("and came"), *Kankarbagh* heard as "Shankar Ghat".

In a call, a fuzzy match becomes one specific question using the known spelling (*"बहेड़ा, सही?"*). `npm run place:dialog` scripts five situations against the live agent (garbled name confirmed in Hindi and in English, garbled name rejected, village not in the gazetteer, exact name): **15/15 over 3 runs**. A place is put to the caller at most once, an exact name costs no question, and an unconfirmed place keeps the case marked approximate. Recorded calls cannot ask, so they fall back to the sound match inside the call's district and stay approximate. On the flood night, the report heard as "Bahad" is now flagged as a possible duplicate of the Bahera case instead of silently opening a separate one; wrong merges stayed at 0 over 2 runs.

**Photo:** on the demo rooftop image SAM 3.1 counted 8 of 8 people; Muse Spark independently counted 8, flagged the child and elderly woman, and judged water at roof level (about 5.5 s for both).

## Safety design

- The agent never refuses, deprioritises or closes a case. Humans assign boats.
- Merges and photo evidence can only raise urgency and headcount.
- Missing information raises priority and a callback flag; it never ranks a caller lower.
- Headcounts are confirmed by digit-by-digit read-back. A misheard place name is confirmed once by its known spelling, and an unconfirmed place keeps the case marked approximate; the agent never swaps an unknown village for a known one.
- No medical advice. Medical emergencies (labour, unconscious, bedridden with water inside) are marked critical for the rescue team.
- No arrival times are promised.

## Run it

Requires Node 22+, a Meta Model API key (dev.meta.ai → API keys; a payment method must be on file even with free credits), and a Chromium browser for the mic.

```sh
npm install
cp .env.example .env        # set MODEL_API_KEY
npm start                   # http://localhost:8787
```

- `/caller`: the browser phone. Use headphones so the agent's voice isn't picked up by the mic.
- `/control`: the control room. **Simulate flood night** replays the 24-call surge.

Evaluations and tools:

```sh
npm test                    # unit tests: place resolution, priority, merging, photo evidence
npm run day1:audio          # regenerate the day-1 test audio (macOS `say` + ffmpeg)
npm run day1:test           # extraction accuracy, biased vs unbiased
npm run day1:test:noisy
npm run surge:eval          # duplicate-merging accuracy over the flood night
npm run place:eval          # place-name resolution on saved real transcripts (no API calls)
npm run place:dialog        # misheard-place scenarios against the live agent
npm run call:fake           # end-to-end live call over the WebSocket with synthetic speech (server must be running)
```

Deploy (Modal, CPU only): `modal secret create jeevan-rekha-meta MODEL_API_KEY=… DEMO_PASSCODE=…` then `modal deploy deploy/modal_app.py`. Setting `DEMO_PASSCODE` locally enables the same gate.

Models: `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` choose the triage model (default in `.env.example`: Muse Spark Open on Baseten); `AGENT_LLM_*` choose the live conversation model (hosted Muse Spark). The control room header shows which model serves each role.

## Architecture

```
browser phone ──24 kHz PCM16──▶ /ws/call ──▶ CallSession
                                              │  Muse Voice Transcribe (realtime, keyword + language biasing)
                                              │  Muse Spark call-taker turn  ──▶ spoken reply (browser TTS)
                                              ▼
recorded calls ──▶ transcribe ──▶ extract ──▶ intake: gazetteer geocoding ▸ duplicate judge ▸ merge / open
caller photo ──▶ SAM 3.1 + Muse Spark ──────▶ photo evidence
                                              ▼
                                   SQLite case store ──SSE──▶ control room (calls, map, queue)
```

| Path | |
|---|---|
| `lib/asr-realtime.mjs` | Realtime Muse Voice Transcribe client |
| `lib/agent.mjs` | Call-taker policy and turn schema |
| `lib/call-session.mjs` | One live call: audio in, agent turns out, case updates |
| `lib/intake.mjs` | Duplicate judgement, merging, photo evidence |
| `lib/gazetteer.mjs` | Keyword lists, place resolution, and the sound-key matcher (`suggestPlaces`) across Latin and Devanagari |
| `lib/place-check.mjs` | Per-call place confirmation: what to tell the agent, at most one question, when a place counts as confirmed |
| `lib/store.mjs` | Case store and priority |
| `lib/photo.mjs` | SAM 3.1 person segmentation and scene assessment |
| `lib/surge.mjs` | Flood-night replay |
| `server/index.mjs` | HTTP, SSE and WebSocket server |
| `public/` | Caller phone, control room, landing page |
| `data/` | Gazetteer (geocoded with OpenStreetMap Nominatim), surge calls and audio, demo photo |

## Limitations

- Demo only: no real helpline is connected; telephony (Exotel/Twilio) would replace the browser phone.
- Muse Voice Transcribe covers Hindi, Bengali, Marathi, Tamil, Telugu, Kannada and English among Indian languages; not Malayalam, Assamese or Odia yet.
- Spoken replies use the browser's speech synthesis; Meta's API has no text-to-speech model.
- The browser phone is half-duplex: while the agent speaks it sends silence (so it never transcribes itself), so a caller who talks over the agent is not heard and the agent asks again. Tested end to end through a real microphone (speech played from laptop speakers); no human caller has been tested yet.
- The gazetteer covers 7 districts (41 places) for the demo. A real district has hundreds of villages, so more names will sound alike: the confirmation question matters more there, and false matches have not been measured at that scale.
- Sound matching handles Latin and Devanagari; Tamil and Telugu place names are matched by spelling only.
- The gazetteer covers 7 districts for the demo; three places resolve only to their district centre and are marked approximate.
- Evaluations use synthetic voices; accuracy on real distress calls is not yet measured.

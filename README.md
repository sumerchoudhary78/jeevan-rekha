# Jeevan Rekha

**When the flood helpline is full, nobody should get a busy tone.**

Jeevan Rekha ("lifeline") is an AI surge call-taker for disaster helplines in India. When every human call-taker is busy, overflow calls go to an agent that:
- listens in the caller's language
- asks only what a rescue boat needs
- reads numbers and places back so "thirty" never becomes "three" and an unknown village never silently becomes a known one
- recognises people who are already reported (a relative's call, a repeat call) by checking the live case board, and asks before joining them to that case
- hands human dispatchers a ranked rescue queue on a map

Callers can also send a photo: SAM 3.1 counts the people on the roof and Muse Spark reads the water level.

> In July 2026, Kosi floodwater cut six villages of Kusheshwar Asthan block in Darbhanga, Bihar, off from the mainland, leaving thousands stranded with 13 boats working ([IANS, 18 July 2026](https://www.socialnews.xyz/2026/07/18/bihar-flood-situation-worsens-in-darbhanga-20-villages-inundated)). When Cyclone Michaung flooded Chennai in December 2023, residents who called the corporation's 1913 helpline found nobody answering or the lines constantly busy: "when hundreds of people try calling the helplines, it becomes difficult to reach through" ([The News Minute, 4 December 2023](https://www.thenewsminute.com/amp/story/tamil-nadu/chennai-floods-helplines-inundated-people-struggle-to-contact-authorities)). Disaster lines are staffed for ordinary days; in a flood they become the bottleneck.

Both places are in the demo: Kusheshwar Asthan is one of the Darbhanga places the agent knows, and Chennai callers are answered in Tamil.

The AI never decides that someone will not be rescued. It collects, confirms and ranks; **humans dispatch**.

**Demo video:** [Watch the submitted demo (4:48)](https://drive.google.com/file/d/11prB2gk0ODhTFa_J3_-cmnsPBJITjX3V/view?usp=sharing). Includes English captions, a live Hindi rescue call, the flood-night control room and an English repeat-caller check.

**Live demo:** [Open Jeevan Rekha](https://sumerchoudhary78--jeevan-rekha-web.us-east.modal.run) (append `?code=<passcode>`; the passcode is in the submission form so the Meta API credits aren't open to everyone). Pages: `/caller` and `/control`.

### Try it in two minutes (in English)

1. Open `/control` and press **Simulate flood night**: 24 recorded calls arrive over about 90 seconds.
2. Open `/caller` in Chrome with headphones, choose **English** and **Patna**, press the green button and, after the tone, say: *"Hello, I am in Kankarbagh sector three in Patna, near the Hanuman temple. The water is rising."*
3. The agent reads the place back ("Kankarbagh, right?"). Say yes. Four people near the Hanuman temple were already reported on the flood night, so it asks whether you are with them. Say *"Yes, that is us."* In the control room your call joins that case (**caller confirmed same group**) instead of opening a duplicate.
4. Press **Assign boat** on that case, then call again from the same page (same phone number). The agent recognises the repeat caller and tells you a boat team is assigned, without promising a time.

The line is one-way while the agent speaks: wait for the tone. The phone screen shows sample lines in each language, with English glosses for Hindi, Tamil and Telugu.

Built for the Meta Global AI Developer Hackathon 2026 (Indie track, *Build for Your World*). Everything in this repository was built during the hackathon.

---

## What it does

| | |
|---|---|
| **Live AI call-taker** | Browser phone streams 24 kHz audio to Muse Voice Transcribe (realtime, endpointing). Muse Spark runs each turn: one question at a time, in the caller's language, safety instructions first when water is chest-high, reads every place back once by its known name from the district gazetteer (garbled ones included), reads headcounts back digit by digit, closes with a real case number. A tone tells the caller when to speak. |
| **Case board** | While a caller is on the line, the agent sees the open cases at the same place, or reported from the same phone number. It asks once whether the caller is part of one of those groups, describing it by place, landmark and number of people (or records the answer if the caller volunteers it), and the call joins that case only when the agent records the caller's yes for a case it was shown on an earlier turn. A joined caller is told the case's status ("a boat team is assigned" / "in the queue") and asked only what has changed. |
| **Case intake & triage** | Every report becomes a case with location (geocoded), headcount, vulnerable people, water level and urgency. Priority = urgency + vulnerable people + headcount + waiting time, so nobody starves in the queue. Missing facts raise a **needs callback** flag; they never lower urgency. |
| **Duplicate merging** | Recorded calls cannot be asked, so Muse Spark judges each against nearby open cases: *same group* (merge), *same pickup point* (merge, headcount becomes a range so the boat is never too small), *possible duplicate* (kept separate and flagged for a human), or *different*. A live caller is asked instead (case board); until they answer, their case is flagged as a possible duplicate. Merges only ever raise urgency and headcount. |
| **Photo evidence** | SAM 3.1 segments every person in the caller's photo; Muse Spark reads water level, visible vulnerable people and boat-approach notes. People counted become a floor on the headcount. |
| **Control room** | Live AI calls, a Leaflet/OpenStreetMap map, and the ranked rescue queue with transcripts, merge badges, photo overlays, assign/rescued actions. |
| **Flood-night simulator** | Replays 24 overlapping phone-quality calls (Hindi, English, Tamil, Telugu) including relatives and neighbours reporting the same rooftops. |

## Meta models

| Model | Used for |
|---|---|
| **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`) | Realtime WebSocket transcription with endpointing for live calls; file transcription for recorded calls. **Keyword biasing** with each district's villages, localities and landmarks (Roman and native script), plus language biasing. |
| **Muse Spark** (`muse-spark-1.3`) | The live call-taker agent (`reasoning_effort: minimal`, strict JSON schema). Each turn also reads the place check and the case board. About 5 s per turn when measured on 28 October (2.5 s on 26 October with the same prompt; a bare one-word request took about 2 s that day). |
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

**Flood-night surge** (`npm run surge:eval`, 24 calls, 19 distinct incidents, 5 with duplicate reports), 2 runs on the current code:

- **0 wrong merges** in both runs.
- Duplicate groups merged automatically: 4 of 5 in one run, including a Hindi call and an English call from a relative about the same school roof. In the other run it was 3 of 5: recognition heard *Bahera* as "Bahad", and both later Bahera reports were flagged **possible duplicate** for a human instead of being merged.
- The garbled third-party call ("second temple" for "Shiv temple") was flagged for a human in both runs.
- A same-village, different-house report stayed separate.
- 24 calls are processed in about 105 s with 4 concurrent workers.

**Open weights: Muse Spark Open on Baseten** (same scripts, triage switched by env vars; ASR is still Muse Voice Transcribe). Keyword-biased results, 2 runs each, with the closed model re-run once on the same prompt:

| | Muse Spark Open (open weights) | Muse Spark 1.3 (hosted) |
|---|---|---|
| Day-1 noisy audio | **19/20** calls correct | 9/10 |
| Day-1 clean audio | 17/20 | 9/10 |
| Flood night, wrong merges | **0** in both runs | 0 |
| Flood night, duplicate groups | run 1: 4/5 merged + 1 flagged (same as hosted); run 2: 4/5 merged, 1 split when ASR heard *Bahera* as "Bahad" | 4/5 merged + 1 flagged |
| Photo scene (vision) | 8 people, water at roof, approach notes (~10 s with SAM in parallel) | 8 people, water at roof (~5.5 s) |

Almost every remaining miss is an ASR mishearing shared by both models ("Tankarbagh", "diarrhea area" for *Diara area*). The first open-weights run surfaced one real problem: the model tagged vulnerable groups nobody mentioned (all five on a "we are safe, need medicine" call) and repeated tags. An explicit prompt rule plus de-duplication fixed it, and the numbers above are after that fix. The live conversation stays on hosted Muse Spark. On 26 October that was for speed: open-weights turns took 2–5 s, with one 12.7 s outlier. By 28 October the open-weights model was the faster one, with a median of 3.1 s against 5.4 s over six identical turns. But in the dialog evals it made a mistake the hosted model never made: after a caller rejected a place, it kept the rejected name in the record, so the place counted as confirmed. It passed 14/15 place dialogs and 9 of the first 11 case-board dialogs: besides the rejected place, it told one caller help "will reach you", and it returned one malformed JSON turn. The hosted model passed 15/15 and 21/21. On a rescue line, speed doesn't outweigh that.

**Callers already reported** (`npm run board:dialog`): seven callers run through the real call session (agent, place check, case board, case store; text in place of audio) against a seeded board. Each caller is played by a second model, the open-weights triage model, from a short persona, so the answers follow whatever the agent actually asks and in whatever order. A first version with fixed scripted lines broke as soon as the agent asked about the place before the case board. The situations: the same group confirming in Hindi and in English, the same group while a garbled duplicate report of it is also open, the same place but a neighbour's family, an unsure caller with a different headcount, a repeat caller whose case has a boat assigned, and a caller with nothing reported nearby. **21/21 over 3 runs.** Each run checks that the call joined the right case or stayed separate, no extra case was opened, the joined case's headcount stayed exactly as it was (not lowered, and not raised by a guess), the agent did not re-ask the headcount after joining, the repeat caller heard the boat status, and no arrival time was promised.

**Place names** (`npm run place:eval`, no API calls): the matcher is replayed over the 233 distinct real transcripts from the day-1 runs (clean and noisy, with and without biasing; kept in `data/place-eval/transcripts.json`), plus 30 lines naming places that are *not* in the gazetteer, including near-misses such as *Basantpatti*, *Benipatti* and *Gaighati*.

| | Spelling-only matcher (before) | Sound-key matcher (after) |
|---|---|---|
| Place found in the raw transcript | 200/233 | **217/233** (179 spelt exactly, 38 by sound) |
| Place found in the extracted area | 218/233 | **223/233** |
| Wrong place | 0 | 0 |
| Not-in-gazetteer lines rejected | 29/30 (the other was silently placed) | 29/30 (the other triggers a confirmation question) |

The sound key folds consonants into classes across Devanagari and Latin (aspirated = plain, retroflex = dental, vowels dropped), and Devanagari is also compared with its vowel signs stripped. That catches *बहड* → Bahera, *Tankarbagh* → Kankarbagh and *औरई* → Aurai, without letting *Bahad* match Bahadurpur. What's left is mostly unrecoverable from text: *Aurai* split into "और आई" ("and came"), *Kankarbagh* heard as "Shankar Ghat".

The 0.84 threshold was chosen on this same data, so `place:eval` also checks it by leaving one call out: each of the 10 calls is scored at a threshold picked on the other nine (and 9/10 of the negatives) by a rule fixed in advance. The folds picked 0.85 nine times and 0.83 once; held out, the matcher still found **217/233 with 0 wrong**, and rejected 28/30 negatives (one more confirmation question than in sample, none placed silently).

**At district scale** (`npm run place:scale`, no API calls). The demo gazetteer knows 7 places in Darbhanga; the district has **1,069 census villages in 18 blocks** (Census 2011), and `data/gazetteer-full/darbhanga.json` adds them, plus OpenStreetMap localities, for 1,126 places. **252 of those villages share their name with another village in the district** (there are seven Bishunpurs), so an exact name is not always enough: same-name villages now give a "which one?" question naming the block.

Replaying the real Darbhanga transcripts against the full list: 45/46 still right with 0 wrong (one *Bahera* call now asks "Bahera or Baheri?", two villages that do sound the same), and 4 of the 5 negative lines whose place *is* a Darbhanga village or block (Jale, Singhwara, Ghanshyampur, Manigachhi) are now found. The replay also showed that, among a thousand names, everyday words start to sound like villages: *पांच* ("five") ~ Punach, *बहुत* ("very") ~ Behta, *से बोल* ~ Sabaul. Common words of a distress call are now excluded from fuzzy matching, and two sound-key bugs were fixed (*chh* in Manigachhi, *सिंह* written "Singh"). That list was written after seeing these replay failures, so the replay is not an unbiased check on it; the held-out test below is.

**Held out**: 60 fresh calls from 30 census villages the demo gazetteer does not know, drawn at random with a fixed seed, each spoken in Hindi and in English, phone-band noise, transcribed by Muse Voice Transcribe (`npm run place:scale:audio`). The matcher was frozen before these were scored. Muse Voice Transcribe accepts **at most 500 keywords** of up to 30 characters, and Darbhanga's villages have 918 distinct names, so the district-scale keyword list holds the demo names, the block names and the most populous villages, and half of the test villages are not in it.

| 60 held-out calls | Right place | Missed (asks for a landmark) | Wrong place, asked | Wrong place, taken without a question |
|---|---|---|---|---|
| Today: demo gazetteer, 32 keywords | — (54 correctly not placed) | — | 3 | **3** |
| District list, 32 keywords | 37 | 14 | 6 | 3 |
| District list, 500 keywords | **38** (20 spelt exactly, 11 by sound, 7 "which of two") | 11 | 6 | **5** |
| … village in the keyword list (30) | 25 | 4 | 0 | 1 |
| … village not in the keyword list (30) | 13 | 7 | 6 | 4 |

The silent errors were not matcher mistakes. In all 8, **keyword biasing made recognition replace the spoken name with a similar name from the keyword list**, which then matched exactly: *Bishunpur* came out as "Benipur", *Bairo* as "Bahera", *Dohatha* as "Dhoi", *Kalwara* as "Karwa". Today's demo has the same failure for callers from villages it doesn't know. So every place is now read back once by its known name, exact matches included, as a call-taker verifies an address. That turns those silent errors into a question the caller can correct (the "caller says no" path is tested in `place:dialog`), at the cost of one turn. This follows from the policy; the 60 calls were not re-run to produce a new number. The district list is measured here but not used by the live demo.

In a call, the read-back uses the known spelling (*"बहेड़ा, सही?"*), so a garbled *बहड* is corrected too. `npm run place:dialog` scripts five situations against the live agent (garbled name confirmed in Hindi and in English, garbled name rejected, village not in the gazetteer, exact name read back): **15/15 over 3 runs**. A place is put to the caller once, it counts as confirmed only after the caller answers, and an unconfirmed place keeps the case marked approximate. Recorded calls cannot ask, so they fall back to the sound match inside the call's district (the district line the call came in on, when the caller names none) and stay approximate.

**Photo:** on the demo rooftop image SAM 3.1 counted 8 of 8 people; Muse Spark independently counted 8, flagged the child and elderly woman, and judged water at roof level (about 5.5 s for both).

## Safety design

- The agent never refuses, deprioritises or closes a case. Humans assign boats.
- Merges and photo evidence can only raise urgency and headcount.
- Missing information raises priority and a callback flag; it never ranks a caller lower.
- Headcounts are confirmed by digit-by-digit read-back. Every place is read back once by its known spelling, because keyword biasing can turn an unknown village into a known name; an unconfirmed place keeps the case marked approximate, and the agent never swaps an unknown village for a known one.
- A call joins an existing case only when the agent records the caller's yes for a case it was shown on an earlier turn, so a yes guessed the moment a case appears, or a case number the model invents, merges nothing. A live caller's headcount reaches a shared case only once it is confirmed by read-back. Until a live caller answers, their case is flagged as a possible duplicate for a human.
- No medical advice. Medical emergencies (labour, unconscious, bedridden with water inside) are marked critical for the rescue team.
- No arrival times are promised.

## Run it

Requires Node 22+, a Meta Model API key (dev.meta.ai → API keys; a payment method must be on file even with free credits), and a Chromium browser for the mic.

```sh
npm install
cp .env.example .env        # set MODEL_API_KEY
npm start                   # http://localhost:8787
```

- `/caller`: the browser phone. Use headphones so the agent's voice isn't picked up by the mic, and speak after the tone.
- `/control`: the control room. **Simulate flood night** replays the 24-call surge.

Location is picked from the caller's device when a call starts (browser permission
required). The caller can turn **Use my location for this rescue** off when reporting
for someone elsewhere. Each case has a map link; selecting a case card or marker
highlights that case and shows its location and device accuracy. Selection stays
in place as the queue updates. See [location and case-map behavior](docs/LOCATION.md).

Evaluations and tools:

```sh
npm test                    # unit tests: place resolution, case board, priority, merging, photo evidence
npm run day1:audio          # regenerate the day-1 test audio (macOS `say` + ffmpeg)
npm run day1:test           # extraction accuracy, biased vs unbiased
npm run day1:test:noisy
npm run surge:eval          # duplicate-merging accuracy over the flood night
npm run place:eval          # place matching on the saved real transcripts, plus the leave-one-call-out check (no API calls)
npm run place:scale         # place matching against all 1,069 Darbhanga villages, replay and held out (no API calls)
npm run place:scale:audio   # regenerate the held-out calls and transcripts (macOS `say` + ffmpeg + Muse Voice Transcribe)
npm run gazetteer:full      # rebuild the district-scale gazetteer from Census 2011 and OpenStreetMap
npm run place:dialog        # place read-back scenarios against the live agent
npm run board:dialog        # case-board scenarios (already-reported callers) against the live agent
npm run call:fake           # end-to-end live call over the WebSocket with synthetic speech (server must be running)
node scripts/fake-caller.mjs ws://localhost:8787 darbhanga board   # same, as a caller already reported on the flood night
```

Deploy (Modal, CPU only): `modal secret create jeevan-rekha-meta MODEL_API_KEY=… DEMO_PASSCODE=…` then `modal deploy deploy/modal_app.py`. Setting `DEMO_PASSCODE` locally enables the same gate.

Models: `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` choose the triage model (default in `.env.example`: Muse Spark Open on Baseten); `AGENT_LLM_*` choose the live conversation model (hosted Muse Spark). The control room header shows which model serves each role.

## Architecture

```
browser phone ──24 kHz PCM16──▶ /ws/call ──▶ CallSession
                                              │  Muse Voice Transcribe (realtime, keyword + language biasing)
                                              │  Muse Spark call-taker turn  ──▶ spoken reply playback
                                              ▼
                                              │  place check + case board notes ◀── case store
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
| `lib/location.mjs` | Device-coordinate validation and rescue-location policy |
| `lib/intake.mjs` | Duplicate judgement, merging, photo evidence |
| `lib/gazetteer.mjs` | Keyword lists, place resolution, and the sound-key matcher (`suggestPlaces`) across Latin and Devanagari |
| `lib/place-check.mjs` | Per-call place confirmation: what to tell the agent, one read-back per place, when a place counts as confirmed |
| `lib/case-board.mjs` | Per-call case board: open cases at the caller's place or from their number, what to tell the agent, when a "yes" joins the call to a case |
| `lib/store.mjs` | Case store and priority |
| `lib/photo.mjs` | SAM 3.1 person segmentation and scene assessment |
| `lib/speech.mjs` | Server-side speech generation |
| `public/speech.js` | Reply playback, cancellation and device-voice fallback |
| `lib/surge.mjs` | Flood-night replay |
| `server/index.mjs` | HTTP, SSE and WebSocket server |
| `public/` | Caller phone, control room, landing page |
| `data/` | Gazetteer (geocoded with OpenStreetMap Nominatim), surge calls and audio, demo photo, place-eval transcripts, the district-scale Darbhanga gazetteer (`gazetteer-full/`, Census 2011 + OpenStreetMap) and the held-out place calls (`place-scale/`) |

## Limitations

- Demo only: no real helpline is connected; telephony (Exotel/Twilio) would replace the browser phone.
- Muse Voice Transcribe covers Hindi, Bengali, Marathi, Tamil, Telugu, Kannada and English among Indian languages; not Malayalam, Assamese or Odia yet. Kerala and Assam, two of the states hit hardest by floods, are out of reach until it does.
- Device-voice fallback depends on the browser and installed voices for language coverage.
- The browser phone is half-duplex: while the agent speaks it sends silence (so it never transcribes itself), so a caller who talks over the agent is not heard and the agent asks again. A tone marks when the line is open. The submitted demo includes a human caller; real distress-call conditions remain untested.
- Spoken-place geocoding covers 7 districts (41 places); three places resolve only to their district centre and are marked approximate. Shared device coordinates can place a caller outside that list. The district-scale list is measured for Darbhanga only and is not used live.
- Keyword biasing is capped at 500 keywords, fewer than one district's village names (918 in Darbhanga), and it can substitute a listed name for an unlisted village (see Results). Biasing per block, once the caller's block is known, is not built.
- Census names are in Latin script only, so Hindi transcripts match them by sound, never by exact spelling; short names (two consonants, such as *Konia* or *Dhoi*) can only match exactly. Sound matching handles Latin and Devanagari; Tamil and Telugu place names are matched by spelling only.
- The case board matches by gazetteer place, distance and phone number. Two different groups with the same landmark in the same village depend on the caller's answer.
- Evaluations use synthetic voices; accuracy on real distress calls is not yet measured.

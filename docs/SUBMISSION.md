# Submission copy

Ready to paste into the Cerebral Valley submission form. Check every number against the latest eval run before submitting.

**Project name:** Jeevan Rekha

**Tagline:** When the flood helpline is full, an AI answers: in Hindi, Tamil, Telugu or English. It asks only what a rescue boat needs and hands humans a ranked queue.

**Track:** Indie Developer · **Problem statement:** Build for Your World

**Bonus categories it fits:** Best Agentic Use-Case (the agent works the live case board: it recognises callers already reported, asks, and joins them to that case on a yes); Best Build on Meta Open Weight Models (all triage runs on Muse Spark Open via Baseten).

## Description

In a flood, disaster helplines flood too. In July 2026, Kosi floodwater cut six villages of Kusheshwar Asthan in Darbhanga, Bihar, off from the mainland, leaving thousands stranded (IANS). When Cyclone Michaung flooded Chennai in December 2023, residents who called the corporation's 1913 helpline found nobody answering or the lines constantly busy (The News Minute). Helplines are staffed for ordinary days.

Jeevan Rekha takes the overflow. A caller who would have got a busy tone reaches an AI call-taker that:

- listens in their language through **Muse Voice Transcribe**, biased with the district's village and landmark names
- asks one question at a time through **Muse Spark**, giving safety instructions first when the water is chest-high
- matches garbled place names by sound across scripts (*बहड* → Bahera, *Tankarbagh* → Kankarbagh) and reads every place back once by its known spelling
- reads headcounts back digit by digit, because "thirty" and "three" are the most dangerous mishearing on a bad line
- checks the live case board while the caller is on the line: if a group at the same place, or this phone number, is already reported, it asks once whether the caller is with them, joins the call to that case on a yes, and tells them its status (a boat assigned or still queued, never an arrival time)

Each report becomes a geocoded case. For recorded calls, which cannot be asked, Muse Spark decides whether a new report is the same group, the same pickup point, a possible duplicate (flagged for a human) or a new incident. Merges only ever raise urgency and headcount. Callers can send a photo: **SAM 3.1** counts the people on the roof and Muse Spark reads the water level and writes approach notes for the boat crew. Dispatchers get a live control room with the ranked queue on a map. The AI never refuses or deprioritises anyone; humans dispatch.

## How we used Meta's models

- **Muse Voice Transcribe:** realtime WebSocket with endpointing for live calls, file transcription for recorded calls, keyword biasing with each district's gazetteer (Roman and native script), and language biasing. We measured biasing at district scale too: it is capped at 500 keywords, and it can substitute a listed name for an unlisted village, which is why every place is read back.
- **Muse Spark 1.3 (hosted):** the live call-taker agent (`reasoning_effort: minimal`, strict JSON schema), which also reads the case board and records whether the caller is a group already reported.
- **Muse Spark Open (open weights, Baseten):** all triage: structured extraction, the duplicate judge and photo scene reading (vision). It also plays the simulated callers in the case-board eval. We measured it as the live conversation model too: on 28 October it was faster than hosted (median 3.1 s against 5.4 s per turn), but in the dialog evals it kept a place the caller had rejected, once told a caller help "will reach you", and returned one malformed turn. The hosted model made none of those mistakes, so the conversation stays hosted.
- **SAM 3.1:** person segmentation on caller photos; boxes rendered for dispatchers.
- **Muse Image:** a synthetic demo photo, so no real victim's image is used.

## Results (synthetic voices, live Meta API)

- **Callers already reported:** in 7 situations run through the real call session, with each caller played by a second model from a persona (same group in Hindi and English, same group with a garbled duplicate on the board, a neighbour's family at the same place, an unsure caller, a repeat caller with a boat assigned, nothing nearby), **21/21 over 3 runs** joined the right case or stayed separate. None re-asked known facts, changed the case's headcount on a guess, or promised a time.
- Replayed over 233 real transcripts, the sound-key place matcher finds the place in **217** (up from 200) with **0 wrong places**, and the same holds when each call is held out of the threshold choice. In scripted calls the agent read places back correctly in 15/15 runs.
- **At district scale:** against all 1,069 census villages of Darbhanga (252 share a name with another village), the real transcripts still gave 0 wrong places. On 60 fresh held-out calls from 30 random villages, 38 were placed right and 5 were silently wrong. All 5 came from keyword biasing replacing the spoken name with a listed one, and today's 7-place demo has the same failure (3 of 60). So every place is now read back once, which turns those into questions the caller can correct.
- On noisy phone-band audio, gazetteer keyword biasing gave **20/20 correct locations** over two runs, against 16/20 without it.
- **Urgency correct on every call** across all test runs.
- Flood night of 24 overlapping calls: **0 wrong merges** in both runs; 3 or 4 of the 5 duplicate groups merged automatically (depending on whether recognition heard *Bahera* or "Bahad"), and the rest were flagged for human review.
- SAM 3.1 counted **8 of 8 people** on the demo rooftop photo.
- **Open weights at parity:** with triage on Muse Spark Open, 19/20 calls correct on noisy audio (2 runs) and 0 wrong merges on the flood night in both runs. The first open-weights run over-tagged vulnerable groups; a prompt rule and de-duplication fixed it.

## Live demo

https://sumerchoudhary78--jeevan-rekha-web.us-east.modal.run/?code=PASSCODE (passcode is in `.env` as `DEMO_PASSCODE`; paste the full link into the form). Use `/caller` (Chrome, headphones) and `/control` → *Simulate flood night*.

## Built with

Node.js, WebSockets, node:sqlite, Leaflet + OpenStreetMap, Web Audio (AudioWorklet), ElevenLabs speech with device-voice fallback (requires the optional ElevenLabs key on the demo server).

---

## X post (Most Viral entry)

> When floods hit, disaster helplines are the first thing to fail. In Chennai's 2023 floods, callers to the city helpline found nobody answering or the lines constantly busy.
>
> I built Jeevan Rekha in 9 days: an AI that answers overflow flood calls in Hindi, Tamil, Telugu & English, asks only what a rescue boat needs, reads numbers back so "30 people" never becomes "3", and knows when your neighbour already reported your roof.
>
> 🎥 [3-min demo]
> Built on @Meta Muse Spark, Voice Transcribe & SAM 3.1 for the #MetaAIHackathon

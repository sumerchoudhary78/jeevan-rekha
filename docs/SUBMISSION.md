# Submission copy

Ready to paste into the Cerebral Valley submission form. Check every number against the latest eval run before submitting.

**Project name:** Jeevan Rekha

**Tagline:** When the flood helpline is full, an AI answers: in Hindi, Tamil, Telugu or English. It asks only what a rescue boat needs and hands humans a ranked queue.

**Track:** Indie Developer · **Problem statement:** Build for Your World

**Bonus categories it fits:** Best Agentic Use-Case. Best Build on Meta Open Weight Models only if the Baseten or Modal run lands before the deadline.

## Description

In a flood, disaster helplines flood too. In July 2026, Assam survivors said most helplines were unreachable; in Kerala's 2018 floods officials begged callers on TV for their exact location and landmarks. Helplines are staffed for ordinary days.

Jeevan Rekha takes the overflow. A caller who would have got a busy tone reaches an AI call-taker that:

- listens in their language through **Muse Voice Transcribe**, biased with the district's village and landmark names
- asks one question at a time through **Muse Spark**, giving safety instructions first when the water is chest-high
- confirms garbled place names against the gazetteer
- reads headcounts back digit by digit, because "thirty" and "three" are the most dangerous mishearing on a bad line

Each report becomes a geocoded case. Muse Spark decides whether a new report is the same group, the same pickup point, a possible duplicate (flagged for a human) or a new incident. Merges only ever raise urgency and headcount. Callers can send a photo: **SAM 3.1** counts the people on the roof and Muse Spark reads the water level and writes approach notes for the boat crew. Dispatchers get a live control room with the ranked queue on a map. The AI never refuses or deprioritises anyone; humans dispatch.

## How we used Meta's models

- **Muse Voice Transcribe:** realtime WebSocket with endpointing for live calls, file transcription for recorded calls, keyword biasing with each district's gazetteer (Roman and native script), and language biasing.
- **Muse Spark 1.3:** the call-taker agent (`reasoning_effort: minimal`, about 2.5 s per turn), structured extraction, duplicate judgement and photo scene reading, all with strict JSON schemas.
- **SAM 3.1:** person segmentation on caller photos; boxes rendered for dispatchers.
- **Muse Image:** a synthetic demo photo, so no real victim's image is used.
- **Open weights:** the triage path runs on Muse Spark Open (Baseten) or Muse Glimmer (Modal + vLLM) via configuration.

## Results (synthetic voices, live Meta API)

- On noisy phone-band audio, gazetteer keyword biasing gave **20/20 correct locations** over two runs, against 16/20 without it.
- **Urgency correct on every call** across all test runs.
- Flood night of 24 overlapping calls: **0 wrong merges**; 4 of 5 duplicate groups merged automatically and the 5th flagged for human review.
- SAM 3.1 counted **8 of 8 people** on the demo rooftop photo.

## Live demo

https://sumerchoudhary78--jeevan-rekha-web.us-east.modal.run/?code=PASSCODE (passcode is in `.env` as `DEMO_PASSCODE`; paste the full link into the form). Use `/caller` (Chrome, headphones) and `/control` → *Simulate flood night*.

## Built with

Node.js, WebSockets, node:sqlite, Leaflet + OpenStreetMap, Web Audio (AudioWorklet), browser speech synthesis.

---

## X post (Most Viral entry)

> When floods hit, disaster helplines are the first thing to fail. Survivors in Assam this July said most numbers were unreachable.
>
> I built Jeevan Rekha in 9 days: an AI that answers overflow flood calls in Hindi, Tamil, Telugu & English, asks only what a rescue boat needs, and reads numbers back so "30 people" never becomes "3".
>
> 🎥 [3-min demo]
> Built on @Meta Muse Spark, Voice Transcribe & SAM 3.1 for the #MetaAIHackathon

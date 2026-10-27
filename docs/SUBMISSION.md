# Submission copy

Ready to paste into the Cerebral Valley submission form. Check every number against the latest eval run before submitting.

**Project name:** Jeevan Rekha

**Tagline:** When the flood helpline is full, an AI answers: in Hindi, Tamil, Telugu or English. It asks only what a rescue boat needs and hands humans a ranked queue.

**Track:** Indie Developer · **Problem statement:** Build for Your World

**Bonus categories it fits:** Best Agentic Use-Case; Best Build on Meta Open Weight Models (all triage runs on Muse Spark Open via Baseten).

## Description

In a flood, disaster helplines flood too. In July 2026, Assam survivors said most helplines were unreachable; in Kerala's 2018 floods officials begged callers on TV for their exact location and landmarks. Helplines are staffed for ordinary days.

Jeevan Rekha takes the overflow. A caller who would have got a busy tone reaches an AI call-taker that:

- listens in their language through **Muse Voice Transcribe**, biased with the district's village and landmark names
- asks one question at a time through **Muse Spark**, giving safety instructions first when the water is chest-high
- matches garbled place names by sound across scripts (*बहड* → Bahera, *Tankarbagh* → Kankarbagh) and confirms them once by their known spelling
- reads headcounts back digit by digit, because "thirty" and "three" are the most dangerous mishearing on a bad line

Each report becomes a geocoded case. Muse Spark decides whether a new report is the same group, the same pickup point, a possible duplicate (flagged for a human) or a new incident. Merges only ever raise urgency and headcount. Callers can send a photo: **SAM 3.1** counts the people on the roof and Muse Spark reads the water level and writes approach notes for the boat crew. Dispatchers get a live control room with the ranked queue on a map. The AI never refuses or deprioritises anyone; humans dispatch.

## How we used Meta's models

- **Muse Voice Transcribe:** realtime WebSocket with endpointing for live calls, file transcription for recorded calls, keyword biasing with each district's gazetteer (Roman and native script), and language biasing.
- **Muse Spark 1.3 (hosted):** the live call-taker agent (`reasoning_effort: minimal`, about 2.5 s per turn, strict JSON schema).
- **Muse Spark Open (open weights, Baseten):** all triage: structured extraction, the duplicate judge and photo scene reading (vision).
- **SAM 3.1:** person segmentation on caller photos; boxes rendered for dispatchers.
- **Muse Image:** a synthetic demo photo, so no real victim's image is used.

## Results (synthetic voices, live Meta API)

- Replayed over 233 real transcripts, the sound-key place matcher finds the place in **217** (up from 200) with **0 wrong places**. In scripted calls the agent confirmed garbled names correctly in 15/15 runs.
- On noisy phone-band audio, gazetteer keyword biasing gave **20/20 correct locations** over two runs, against 16/20 without it.
- **Urgency correct on every call** across all test runs.
- Flood night of 24 overlapping calls: **0 wrong merges**; 4 of 5 duplicate groups merged automatically and the 5th flagged for human review.
- SAM 3.1 counted **8 of 8 people** on the demo rooftop photo.
- **Open weights at parity:** with triage on Muse Spark Open, 19/20 calls correct on noisy audio (2 runs) and 0 wrong merges on the flood night in both runs. The first open-weights run over-tagged vulnerable groups; a prompt rule and de-duplication fixed it.

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

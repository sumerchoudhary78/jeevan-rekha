# Demo video script (3:00)

Judges score the video as a main artifact, so it should show the agent working live rather than slides.
Record at 1440p with two windows side by side: the **caller phone** (`/caller`) on the left and the **control room** (`/control`) on the right. Use headphones so the agent's voice doesn't feed back into the mic.

Rule from the organisers: open with one line saying what existed before. For Jeevan Rekha: *"Everything shown was built during the hackathon."*

---

### 0:00–0:15 · The problem (voice-over on a black screen with two quotes)

> "Everything you'll see was built during this hackathon."
> In July 2026, Assam flood survivors said *most helplines were unreachable*. In Kerala's 2018 floods, officials begged callers on TV to give their exact location and landmarks. When rivers rise, the phone lines fail first.

### 0:15–1:10 · A live call (split screen)

1. Press call, speak Hindi: *"हैलो, हम दरभंगा के बहेड़ा गांव में फंसे हैं, पानी बढ़ रहा है"*
2. The agent confirms the garbled village name against the district gazetteer (*"बहेड़ा, सही?"*), then asks for the nearest landmark.
3. Say *"हम तीस लोग हैं"*. The agent reads it back digit by digit: *"तीस, यानी तीन-शून्य, सही?"*
   **Call out:** thirty and three are the most dangerous mishearing on a bad line.
4. Say *"पानी खिड़की तक है"*. The case on the right turns **critical** and the agent gives safety instructions first.
5. Tap **Send photo**. SAM 3.1 boxes appear on the photo in the control room: *"SAM 3.1 counted 8"*, plus Muse Spark's approach notes for the boat crew.

### 1:10–1:55 · Flood night (control room full screen)

1. Click **Simulate flood night**: 24 overlapping calls in Hindi, English, Tamil and Telugu.
2. Point at the left column (the AI answering every call) and the map filling up.
3. Show a merged card, e.g. **"2 calls merged"** at Bhimnagar school: one call in Hindi, one in English from a relative.
4. Show a **"possible duplicate of JR-…"** badge. The AI didn't merge a garbled report and asked a human instead.
5. Show a **"needs callback"** badge on a call where the line dropped the headcount.
6. Click **Assign boat** on the top card and watch the queue re-rank.

### 1:55–2:30 · How it works (one diagram, then numbers)

- Muse Voice Transcribe, **primed with district village and landmark names**: on noisy phone-band audio this took location accuracy from **6/10 to 10/10**.
- Muse Spark runs each turn with `reasoning_effort: minimal`, about **2.5 s** per turn.
- The duplicate judge has three verdicts (same group / same pickup point / possible duplicate) and made **0 wrong merges** across the 24-call night.
- SAM 3.1 counts people and Muse Spark reads the water level from caller photos.
- *(If Baseten or Modal credits arrive)* triage runs on open-weight Muse Spark Open or Muse Glimmer.

### 2:30–2:50 · Safety by design

- The AI never refuses or deprioritises anyone. It collects and ranks; **humans dispatch boats**.
- Urgency and headcount can only go **up** when reports merge.
- Missing facts raise priority and trigger a callback. They never lower it.
- No medical advice: medical emergencies are flagged as a rescue priority.

### 2:50–3:00 · Close

> Jeevan Rekha: when the helpline is full, nobody gets a busy tone.
> Hindi, Bengali, Marathi, Tamil, Telugu, Kannada, English. Built on Meta Muse models.

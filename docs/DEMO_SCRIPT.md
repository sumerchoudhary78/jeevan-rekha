# Demo video script (3:00)

Judges score the video as a main artifact, so it should show the agent working live rather than slides.
Record at 1440p with two windows side by side: the **caller phone** (`/caller`) on the left and the **control room** (`/control`) on the right. Use headphones so the agent's voice doesn't feed back into the mic, and speak after the tone.
Burn in English subtitles for every Hindi line (the agent's and yours): most judges won't speak Hindi.

Rule from the organisers: open with one line saying what existed before. For Jeevan Rekha: *"Everything shown was built during the hackathon."*

---

### 0:00–0:15 · The problem (voice-over on a black screen with two quotes)

> "Everything you'll see was built during this hackathon."
> In July 2026, Kosi floodwater cut six villages of Kusheshwar Asthan in Darbhanga off from the mainland; thousands were stranded (IANS). When Cyclone Michaung flooded Chennai, people calling the city's flood helpline found nobody answering, or the lines busy (The News Minute). When rivers rise, the phone lines fail first.

### 0:15–1:00 · A live call (split screen)

1. Press call, speak Hindi: *"हैलो, हम दरभंगा के बहेड़ा गांव में फंसे हैं, पानी बढ़ रहा है"*
2. The agent reads the village back by its known name (*"बहेड़ा, सही?"*), then asks for the nearest landmark.
3. Say *"हम तीस लोग हैं"*. The agent reads it back digit by digit: *"तीस, यानी तीन-शून्य, सही?"*
   **Call out:** thirty and three are the most dangerous mishearing on a bad line.
4. Say *"पानी खिड़की तक है"*. The case on the right turns **critical** and the agent gives safety instructions first.
5. Tap **Send photo**. SAM 3.1 boxes appear on the photo in the control room: *"SAM 3.1 counted 8"*, plus Muse Spark's approach notes for the boat crew.

### 1:00–1:35 · Flood night (control room full screen)

1. Click **Simulate flood night**: 24 overlapping calls in Hindi, English, Tamil and Telugu.
2. Point at the left column (the AI answering every call) and the map filling up.
3. Show a merged card, e.g. **"2 calls merged"** at Bhimnagar school: one call in Hindi, one in English from a relative.
4. Show a **"possible duplicate of JR-…"** badge: the AI didn't merge a garbled report and asked a human instead.

### 1:35–2:05 · A caller who is already reported (split screen, in English)

1. Pick **English** and **Patna**, call: *"Hello, I am in Kankarbagh sector three, near the Hanuman temple. The water is rising."*
2. The agent reads the place back, then asks something like *"Are you with the group of 4 people near the Hanuman temple?"* (its wording varies). Say *"Yes, my son called earlier."*
3. On the right, the call joins that case (**caller confirmed same group**) instead of opening a duplicate, and the agent asks only what has changed.
   **Call out:** families call again and again in a flood; the agent checks the live case board and asks, rather than guessing.
4. Click **Assign boat** on that case, call again from the same phone: the agent recognises the number and says a boat team is assigned, without promising a time.

### 2:05–2:35 · How it works (one diagram, then numbers)

- Muse Voice Transcribe, **primed with district village and landmark names**: on noisy phone-band audio this took location accuracy from **16/20 to 20/20** over two runs.
- Tested at district scale: all 1,069 villages of Darbhanga. Biasing is capped at 500 names, and on held-out calls it sometimes swapped an unknown village for a listed one, so **every place is read back**.
- Case board: **21/21** simulated callers joined the right case or stayed separate. Duplicate judge for recorded calls: **0 wrong merges** across the 24-call night.
- All triage (extraction, duplicate judge, photo reading) runs on **open-weight Muse Spark Open** on Baseten. Point at the model line in the control-room header.

### 2:35–2:50 · Safety by design

- The AI never refuses or deprioritises anyone. It collects and ranks; **humans dispatch boats**.
- A caller joins an existing case only by saying yes; urgency and headcount can only go **up** when reports merge.
- Missing facts raise priority and trigger a callback. They never lower it.
- No medical advice and no arrival times.

### 2:50–3:00 · Close

> Jeevan Rekha: when the helpline is full, nobody gets a busy tone.
> Hindi, Bengali, Marathi, Tamil, Telugu, Kannada, English. Built on Meta Muse models.

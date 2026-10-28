const $ = (id) => document.getElementById(id);
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const FRAME_SAMPLES = 1920; // 80 ms at 24 kHz

// Lines to try, per language, with an English gloss for people who don't speak it.
const HINTS = {
  'en-IN': [
    ['Hello, I am in Kankarbagh sector three in Patna, near the Hanuman temple. The water is rising.'],
    ['We are four people. My father is eighty and cannot walk.'],
    ['The water is up to the windows now.'],
  ],
  'hi-IN': [
    ['हम दरभंगा के बहेड़ा गांव में फंसे हैं, शिव मंदिर के पीछे।', 'We are stuck in Bahera village, Darbhanga, behind the Shiv temple.'],
    ['हम तीस लोग हैं।', 'We are thirty people. Listen for the digit-by-digit read-back.'],
    ['पानी खिड़की तक है।', 'The water is up to the window.'],
  ],
  'ta-IN': [
    ['சென்னை வேளச்சேரி, விஜயநகர், பிள்ளையார் கோவில் அருகில்.', 'Velachery, Vijayanagar, Chennai, near the Pillaiyar temple.'],
    ['நாங்கள் நான்கு பேர்.', 'We are four people.'],
  ],
  'te-IN': [
    ['విజయవాడ సింగ్ నగర్, డాబా గార్డెన్స్ దగ్గర.', 'Singh Nagar, Vijayawada, near Dabha Gardens.'],
    ['మా ఇంట్లో ఆరుగురు ఉన్నాం.', 'There are six of us at home.'],
  ],
};

let ws, audioCtx, micStream, workletNode;
let agentSpeaking = false;
let level = 0; // microphone level, for the meter
let pending = new Float32Array(0);
let partialEl = null;
let callComplete = false;
let caseId = null;

const config = await fetch('/api/config').then((r) => r.json());
for (const d of config.districts) $('district').append(new Option(`${d.name}, ${d.state}`, d.key));
// Each page load is a new caller; calling again from the same page is a repeat caller.
const digits = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
$('caller').value = `+91 98${digits(3)} ${digits(5)}`;

function renderHints() {
  if (!$('hints')) return; // cleared once a call has started
  const lines = HINTS[$('lang').value] ?? [];
  $('hints').innerHTML = lines.length
    ? `<b>Try saying</b><ol>${lines.map(([t, gloss]) => `<li>${esc(t)}${gloss ? `<span class="gloss">${esc(gloss)}</span>` : ''}</li>`).join('')}</ol>`
    : '';
}
$('lang').onchange = renderHints;

function setStatus(text, state = '') {
  $('status').textContent = text;
  $('dot').className = `dot ${state}`;
}

function bubble(role, text, extraClass = '') {
  $('empty')?.remove();
  const el = document.createElement('div');
  el.className = `bubble ${role} ${extraClass}`;
  el.innerHTML = `<span class="who">${role === 'agent' ? 'Jeevan Rekha (AI)' : 'You'}</span>`;
  el.append(text);
  $('chat').append(el);
  $('chat').scrollTop = $('chat').scrollHeight;
  return el;
}

function showRecord(record, caseId) {
  if (!record) return;
  const people = record.headcount.max
    ? `${record.headcount.min === record.headcount.max ? record.headcount.max : `${record.headcount.min}–${record.headcount.max}`}${record.headcount_confirmed ? ' ✓ confirmed' : ' (unconfirmed)'}`
    : '—';
  const rows = [
    ['Case', caseId ?? 'opens when location is known'],
    ['Where', [record.location.area, record.location.landmark, record.location.district].filter(Boolean).join(' · ') || '—'],
    ['People', people],
    ['Vulnerable', record.vulnerable.join(', ').replaceAll('_', ' ') || '—'],
    ['Water', record.water_level.replaceAll('_', ' ')],
    ['Urgency', `<span class="badge u-${record.urgency}">${record.urgency}</span>`],
  ];
  $('record').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('understood').classList.add('show');
}

function pickVoice(lang) {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
}

// A short tone when the agent has finished: the line is one-way while it talks, so this is
// the caller's cue to speak.
function tone() {
  return new Promise((resolve) => {
    if (!audioCtx) return resolve();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const t = audioCtx.currentTime;
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.onended = resolve;
    setTimeout(resolve, 400); // a suspended AudioContext never ends the tone
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

function speak(text, lang) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.rate = 1.0;
    agentSpeaking = true;
    setStatus('Agent speaking · wait for the tone', 'speaking');
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      clearTimeout(stuck);
      if (!callComplete) {
        await tone();
        await new Promise((r) => setTimeout(r, 150)); // let the tone die away before the mic opens
      }
      agentSpeaking = false;
      if (!callComplete) setStatus('Your turn · speak now', 'live');
      resolve();
    };
    // Chrome sometimes never fires onend; never leave the caller's mic closed.
    const stuck = setTimeout(() => {
      speechSynthesis.cancel();
      finish();
    }, 4000 + text.length * 120);
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  });
}

function drawMeter() {
  if (!ws) return;
  const bar = $('meter').firstElementChild;
  bar.style.width = `${Math.min(100, level * 600)}%`;
  $('meter').classList.toggle('muted', agentSpeaking);
  level *= 0.8;
  requestAnimationFrame(drawMeter);
}

// Mic samples arrive in small blocks; send fixed 80 ms PCM16 frames.
// While the agent talks, send silence so its own voice is not transcribed
// and the stream keeps its real-time pace.
function onSamples(samples) {
  let sum = 0;
  for (const s of samples) sum += s * s;
  level = Math.max(level, Math.sqrt(sum / samples.length));
  const merged = new Float32Array(pending.length + samples.length);
  merged.set(pending);
  merged.set(samples, pending.length);
  let offset = 0;
  while (merged.length - offset >= FRAME_SAMPLES) {
    const frame = new Int16Array(FRAME_SAMPLES);
    if (!agentSpeaking) {
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        const s = Math.max(-1, Math.min(1, merged[offset + i]));
        frame[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
    }
    if (ws?.readyState === WebSocket.OPEN) ws.send(frame.buffer);
    offset += FRAME_SAMPLES;
  }
  pending = merged.slice(offset);
}

async function startCall() {
  callComplete = false;
  caseId = null;
  $('photoBtn').disabled = true;
  $('done').classList.remove('show');
  $('chat').innerHTML = '';
  $('understood').classList.remove('show');
  setStatus('Connecting…', 'thinking');

  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  audioCtx = new AudioContext({ sampleRate: 24000 });
  await audioCtx.audioWorklet.addModule('/pcm-worklet.js');
  workletNode = new AudioWorkletNode(audioCtx, 'pcm-capture');
  workletNode.port.onmessage = (e) => onSamples(e.data);
  audioCtx.createMediaStreamSource(micStream).connect(workletNode);

  const params = new URLSearchParams({ lang: $('lang').value, district: $('district').value, caller: $('caller').value });
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/call?${params}`);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'partial') {
      if (!partialEl) partialEl = bubble('caller', '', 'partial');
      partialEl.lastChild.textContent = msg.text;
    } else if (msg.type === 'caller') {
      partialEl?.remove();
      partialEl = null;
      bubble('caller', msg.text);
      setStatus('Thinking…', 'thinking');
    } else if (msg.type === 'agent') {
      if (msg.caseId) {
        caseId = msg.caseId;
        $('photoBtn').disabled = false;
      }
      bubble('agent', msg.text);
      showRecord(msg.record, msg.caseId);
      if (msg.complete) callComplete = true;
      await speak(msg.text, msg.lang);
      if (msg.complete) {
        $('done').textContent = `Case ${msg.caseId ?? ''} is with the rescue control room.`;
        $('done').classList.add('show');
        setTimeout(endCall, 800);
      }
    } else if (msg.type === 'error') {
      bubble('agent', `⚠ ${msg.message}`);
    }
  };
  ws.onclose = () => endCall();
  requestAnimationFrame(drawMeter);
  $('settings').querySelectorAll('select,input').forEach((el) => (el.disabled = true));
  $('callBtn').className = 'call-btn end';
  $('callBtn').textContent = '✕';
}

function endCall() {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'hangup' }));
  ws?.close();
  ws = null;
  micStream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();
  audioCtx = null;
  speechSynthesis.cancel();
  agentSpeaking = false;
  $('meter').firstElementChild.style.width = '0';
  $('meter').classList.add('muted');
  $('settings').querySelectorAll('select,input').forEach((el) => (el.disabled = false));
  $('callBtn').className = 'call-btn start';
  $('callBtn').textContent = '✆';
  if (!callComplete) setStatus('Call ended.');
  else setStatus('Call complete. Help is being coordinated.');
}

// Photos are downscaled in the browser (long side 1280 px) before upload.
async function toJpegDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

$('photoBtn').onclick = () => $('photoInput').click();
$('photoInput').onchange = async () => {
  const file = $('photoInput').files[0];
  $('photoInput').value = '';
  if (!file || !caseId) return;
  const dataUrl = await toJpegDataUrl(file);
  const img = Object.assign(document.createElement('img'), { src: dataUrl });
  img.style.cssText = 'max-width:100%;border-radius:8px;display:block';
  bubble('caller', img);
  const note = bubble('agent', 'Photo received. Counting people and checking the water level…');
  const res = await fetch(`/api/cases/${caseId}/photo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) });
  if (!res.ok) return (note.lastChild.textContent = 'Sorry, the photo could not be analysed.');
  const { evidence } = await res.json();
  note.lastChild.textContent =
    `Photo added to case ${caseId}: ${evidence.people.count} people counted, water at ${evidence.scene.water_level.replaceAll('_', ' ')} level. ` +
    'The rescue team can see it.';
};

$('callBtn').onclick = () => (ws ? endCall() : startCall().catch((err) => { setStatus(`Could not start: ${err.message}`); endCall(); }));
speechSynthesis.getVoices();

// Kiosk / test mode: /caller?autocall=1&lang=hi-IN&district=darbhanga starts the call on load.
const query = new URLSearchParams(location.search);
if (query.has('lang')) $('lang').value = query.get('lang');
if (query.has('district')) $('district').value = query.get('district');
renderHints();
if (query.get('autocall') === '1') startCall().catch((err) => setStatus(`Could not start: ${err.message}`));

const $ = (id) => document.getElementById(id);
const FRAME_SAMPLES = 1920; // 80 ms at 24 kHz

let ws, audioCtx, micStream, workletNode;
let agentSpeaking = false;
let pending = new Float32Array(0);
let partialEl = null;
let callComplete = false;

const config = await fetch('/api/config').then((r) => r.json());
for (const d of config.districts) $('district').append(new Option(`${d.name}, ${d.state}`, d.key));

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

function speak(text, lang) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.rate = 1.0;
    agentSpeaking = true;
    setStatus('Agent speaking…', 'speaking');
    const finish = () => {
      agentSpeaking = false;
      if (!callComplete) setStatus('Listening… speak now', 'live');
      resolve();
    };
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  });
}

// Mic samples arrive in small blocks; send fixed 80 ms PCM16 frames.
// While the agent talks, send silence so its own voice is not transcribed
// and the stream keeps its real-time pace.
function onSamples(samples) {
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
  $('settings').querySelectorAll('select,input').forEach((el) => (el.disabled = false));
  $('callBtn').className = 'call-btn start';
  $('callBtn').textContent = '✆';
  if (!callComplete) setStatus('Call ended.');
  else setStatus('Call complete. Help is being coordinated.');
}

$('callBtn').onclick = () => (ws ? endCall() : startCall().catch((err) => { setStatus(`Could not start: ${err.message}`); endCall(); }));
speechSynthesis.getVoices();

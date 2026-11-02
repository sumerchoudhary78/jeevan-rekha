const $ = (id) => document.getElementById(id);
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const COLORS = { critical: '#c62828', high: '#d9730d', medium: '#b58a00', low: '#5b6b7a' };
const LANG_NAMES = { 'hi-IN': 'Hindi', 'en-IN': 'English', 'ta-IN': 'Tamil', 'te-IN': 'Telugu', hi: 'Hindi', en: 'English', ta: 'Tamil', te: 'Telugu' };

let cases = new Map();
const calls = new Map(); // callId -> { el, live, lines }
const markers = new Map();
let mergedCount = 0;
let callsAnswered = 0;
let fitted = false;
let selectedCaseId = null;
const requestedCase = new URLSearchParams(location.search).get('case');
let pendingCaseId = /^JR-\d+$/.test(requestedCase ?? '') ? requestedCase : null;
let accuracyCircle = null;

const map = L.map('map', { zoomControl: true }).setView([25.9, 85.6], 7);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const waited = (c) => {
  const min = Math.floor((Date.now() - c.createdAt) / 60000);
  return min < 1 ? 'just now' : `${min} min waiting`;
};
const people = (c) => (c.headcountMax ? (c.headcountMin === c.headcountMax ? c.headcountMax : `${c.headcountMin}–${c.headcountMax}`) : '?');
const locationLabel = (c) => c.locationSource === 'device'
  ? `Device location · accuracy about ${Math.ceil(c.locationAccuracy ?? 0)} m`
  : 'Location reported by caller';

function renderSelection() {
  accuracyCircle?.remove();
  accuracyCircle = null;
  const c = cases.get(selectedCaseId);
  if (!c) {
    $('mapSelection').innerHTML = '<strong>Select a rescue case</strong><span>Pick a case card or map marker to see its location.</span>';
    return;
  }
  $('mapSelection').innerHTML = `<strong>${esc(c.id)} · ${esc(c.place || c.area || c.landmark || 'Rescue location')}</strong><span>${
    c.lat == null || c.lon == null ? 'Location still being collected' :
    `${esc(locationLabel(c))} · ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`}</span>`;
  if (c.locationSource === 'device' && c.lat != null && c.lon != null && Number.isFinite(c.locationAccuracy)) {
    accuracyCircle = L.circle([c.lat, c.lon], {
      radius: Math.max(1, c.locationAccuracy), color: '#0f6e5c', fillOpacity: 0.08, weight: 1, interactive: false,
    }).addTo(map);
    markers.get(c.id)?.bringToFront();
  }
}

function selectCase(id, { scroll = false } = {}) {
  const c = cases.get(id);
  if (!c || !['open', 'assigned'].includes(c.status)) return;
  map.closePopup();
  selectedCaseId = id;
  pendingCaseId = null;
  const url = new URL(location.href);
  url.searchParams.set('case', id);
  history.replaceState(null, '', url);
  renderQueue();
  const marker = markers.get(id);
  if (marker) {
    if (accuracyCircle) map.fitBounds(accuracyCircle.getBounds(), { maxZoom: 16, padding: [35, 35] });
    else map.setView(marker.getLatLng(), 13);
    marker.bringToFront().openPopup();
  }
  if (scroll) $('queue').querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function renderStats() {
  const open = [...cases.values()].filter((c) => c.status === 'open' || c.status === 'assigned');
  $('sCalls').textContent = callsAnswered;
  $('sLive').textContent = [...calls.values()].filter((c) => c.live).length;
  $('sOpen').textContent = open.filter((c) => c.status === 'open').length;
  $('sPeople').textContent = open.reduce((n, c) => n + (c.headcountMax || 0), 0);
  $('sMerged').textContent = mergedCount;
}

function renderMarker(c) {
  const existing = markers.get(c.id);
  if (c.lat == null || c.lon == null || c.status === 'rescued' || c.status === 'merged') {
    existing?.remove();
    markers.delete(c.id);
    return;
  }
  const selected = c.id === selectedCaseId;
  const radius = 8 + Math.min(c.headcountMax || 1, 60) / 3 + (selected ? 3 : 0);
  const style = { radius, color: selected ? '#0f6e5c' : COLORS[c.urgency], fillColor: COLORS[c.urgency], fillOpacity: c.status === 'assigned' ? 0.2 : 0.55, weight: selected ? 4 : 2 };
  const popup = `<b>${esc(c.id)}</b> · ${esc(c.urgency)}<br>${esc(c.place || c.area || 'Shared rescue location')}${c.landmark ? ` · ${esc(c.landmark)}` : ''}<br>${people(c)} people · ${c.reports.length} report(s)<br>${esc(locationLabel(c))}${c.approximate ? '<br><i>address or position still approximate</i>' : ''}`;
  if (existing) {
    const previous = existing.getLatLng();
    existing.setLatLng([c.lat, c.lon]).setStyle(style).setRadius(radius).setPopupContent(popup);
    if (selected && (previous.lat !== c.lat || previous.lng !== c.lon)) map.panTo([c.lat, c.lon]);
  } else {
    const m = L.circleMarker([c.lat, c.lon], style).bindPopup(popup).bindTooltip(c.id).addTo(map);
    m.on('click', () => selectCase(c.id, { scroll: true }));
    markers.set(c.id, m);
  }
  if (selected) markers.get(c.id).bringToFront();
}

function caseCard(c) {
  const el = document.createElement('div');
  el.className = `case ${c.urgency} ${c.status}${c.id === selectedCaseId ? ' selected' : ''}`;
  el.dataset.id = c.id;
  el.tabIndex = 0;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', `Rescue case ${c.id}; press Enter to show on map`);
  if (c.id === selectedCaseId) el.setAttribute('aria-current', 'true');
  const vulnerable = c.vulnerable.map((v) => `<span class="badge b-neutral">${esc(v.replaceAll('_', ' '))}</span>`).join('');
  const transcripts = c.reports.map((r) => `<pre>${esc(r.transcript)}</pre>`).join('');
  el.innerHTML = `
    <div class="row">
      <span><span class="badge u-${c.urgency}">${c.urgency}</span> <span class="tiny">${c.id}</span></span>
      <span class="prio" title="priority score">${c.priority}</span>
    </div>
    <div class="where">${esc(c.place || c.area || (c.locationSource === 'device' ? 'Shared rescue location' : 'Unknown location'))}${c.landmark ? ` · <span class="muted">${esc(c.landmark)}</span>` : ''}</div>
    <div class="facts">${people(c)} people${c.headcountConfirmed ? ' ✓' : ''} · water ${esc(c.waterLevel.replaceAll('_', ' '))} · ${waited(c)}</div>
    <div class="facts">${esc(c.summary)}</div>
    <div class="badges">
      ${vulnerable}
      ${c.reports.length > 1 ? `<span class="badge b-ok">${c.reports.length} calls merged</span>` : ''}
      ${c.reports.some((r) => r.joinedByCaller) ? '<span class="badge b-ok" title="A caller confirmed on the line that they are part of this group">caller confirmed same group</span>' : ''}
      ${c.notDuplicateOf?.length ? `<span class="badge b-neutral" title="The caller said they are not part of these groups">caller: not ${esc(c.notDuplicateOf.join(', '))}</span>` : ''}
      ${c.needsCallback ? '<span class="badge u-high">needs callback: details missing</span>' : ''}
      ${c.possibleDuplicateOf ? `<span class="badge u-medium" title="A human should check">possible duplicate of ${esc(c.possibleDuplicateOf)}</span>` : ''}
      ${c.assignedTeam ? `<span class="badge b-ok">${esc(c.assignedTeam)}</span>` : ''}
      ${c.approximate ? '<span class="badge b-neutral">approx. location</span>' : ''}
      ${c.locationSource === 'device' ? `<span class="badge b-ok">device location ±${Math.ceil(c.locationAccuracy ?? 0)} m</span>` : ''}
      ${c.photoEvidence ? `<span class="badge b-ok">📷 SAM 3.1 counted ${c.photoEvidence.samCount}</span>` : ''}
    </div>
    <div class="btns">
      ${c.status === 'open' ? '<button data-act="assign">Assign boat</button>' : '<button data-act="reopen">Unassign</button>'}
      <button data-act="rescued">Mark rescued</button>
    </div>
    ${c.photoEvidence ? `<div class="photo"><canvas data-photo="${c.id}"></canvas><div class="tiny">${esc(c.photoEvidence.scene.rescue_notes)}</div></div>` : ''}
    <details><summary>Call transcripts (${c.reports.length})</summary>${transcripts}</details>`;
  if (c.photoEvidence) drawPhoto(el.querySelector('canvas'), c);
  el.onclick = (e) => {
    const act = e.target.dataset?.act;
    if (act) {
      e.stopPropagation();
      const team = act === 'assign' ? `Boat ${Math.floor(Math.random() * 20) + 1}` : undefined;
      fetch(`/api/cases/${c.id}/${act}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team }) });
      return;
    }
    if (e.target.closest('details')) return;
    selectCase(c.id);
  };
  el.onkeydown = (e) => {
    if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectCase(c.id); }
  };
  return el;
}

// The caller's photo with SAM 3.1's person boxes drawn on top.
const photoCache = new Map();
function drawPhoto(canvas, c) {
  const key = `${c.id}:${c.photoEvidence.at}`;
  let img = photoCache.get(key);
  if (!img) {
    img = new Image();
    img.src = `/api/cases/${c.photoEvidence.caseId ?? c.id}/photo?t=${c.photoEvidence.at}`; // a joined case keeps the image where it was sent
    photoCache.set(key, img);
  }
  const paint = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    ctx.lineWidth = Math.max(3, img.naturalWidth / 300);
    ctx.strokeStyle = '#ffd43b';
    ctx.font = `${Math.max(16, img.naturalWidth / 50)}px sans-serif`;
    ctx.fillStyle = '#ffd43b';
    for (const b of c.photoEvidence.boxes) {
      const sx = img.naturalWidth / b.w;
      const sy = img.naturalHeight / b.h;
      ctx.strokeRect(b.x1 * sx, b.y1 * sy, (b.x2 - b.x1) * sx, (b.y2 - b.y1) * sy);
    }
  };
  if (img.complete && img.naturalWidth) paint();
  else img.addEventListener('load', paint, { once: true });
}

function renderQueue(flashId) {
  const open = [...cases.values()]
    .filter((c) => c.status === 'open' || c.status === 'assigned')
    .sort((a, b) => (a.status === b.status ? b.priority - a.priority : a.status === 'open' ? -1 : 1));
  if (selectedCaseId && !open.some((c) => c.id === selectedCaseId)) {
    selectedCaseId = null;
    map.closePopup();
    const url = new URL(location.href);
    url.searchParams.delete('case');
    history.replaceState(null, '', url);
  }
  $('queue').replaceChildren(...(open.length ? open.map(caseCard) : [Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No open cases.' })]));
  if (flashId) $('queue').querySelector(`[data-id="${flashId}"]`)?.classList.add('flash');
  for (const c of cases.values()) renderMarker(c);
  for (const [id, marker] of markers) if (!cases.has(id)) { marker.remove(); markers.delete(id); }
  renderSelection();
  renderStats();
  if (pendingCaseId && open.some((c) => c.id === pendingCaseId)) return selectCase(pendingCaseId, { scroll: true });
  if (!selectedCaseId && !fitted && markers.size) {
    map.fitBounds(L.featureGroup([...markers.values()]).getBounds().pad(0.3), { maxZoom: 14 });
    fitted = markers.size > 3;
  }
}

function callCard(callId, meta) {
  let call = calls.get(callId);
  if (call) return call;
  $('calls').querySelector('.empty')?.remove();
  const el = document.createElement('div');
  el.className = 'call live';
  el.innerHTML = `<div class="head"><b>${meta.simulated ? 'Recorded call' : 'Live call'} · ${esc(LANG_NAMES[meta.lang] ?? '')}</b><span class="badge b-ok">answering</span></div><div class="lines"></div><div class="outcome"></div><button class="case-map-link" hidden>Show case on map</button>`;
  $('calls').prepend(el);
  call = { el, live: true, partial: null };
  el.querySelector('.case-map-link').onclick = () => selectCase(call.caseId, { scroll: true });
  calls.set(callId, call);
  callsAnswered++;
  return call;
}

function addLine(call, role, text) {
  const lines = call.el.querySelector('.lines');
  call.partial?.remove();
  call.partial = null;
  const line = document.createElement('div');
  line.className = `line ${role}`;
  line.textContent = text;
  lines.append(line);
  lines.scrollTop = lines.scrollHeight;
}

function onCallEvent(e) {
  if (e.type === 'started') return callCard(e.callId, e), renderStats();
  const call = calls.get(e.callId) ?? callCard(e.callId, e);
  const outcome = call.el.querySelector('.outcome');
  if (e.caseId) {
    call.caseId = e.caseId;
    const link = call.el.querySelector('.case-map-link');
    link.hidden = false;
    link.textContent = `Show ${e.caseId} on map`;
  }
  switch (e.type) {
    case 'partial': {
      if (!call.partial) {
        call.partial = document.createElement('div');
        call.partial.className = 'line caller partial';
        call.el.querySelector('.lines').append(call.partial);
      }
      call.partial.textContent = e.text;
      break;
    }
    case 'caller': addLine(call, 'caller', e.text); break;
    case 'agent': addLine(call, 'agent', e.text); if (e.caseId) outcome.textContent = `Case ${e.caseId}`; break;
    case 'opened':
      outcome.innerHTML = e.possibleDuplicateOf
        ? `Opened ${esc(e.caseId)} · <span class="badge u-medium">possible duplicate of ${esc(e.possibleDuplicateOf)}</span> ${esc(e.reason ?? '')}`
        : `Opened ${esc(e.caseId)}`;
      break;
    case 'merged':
      mergedCount++;
      outcome.innerHTML = `<span class="badge b-ok">${e.relation === 'same_pickup_point' ? 'Same pickup point as' : 'Merged into'} ${esc(e.caseId)}</span> ${esc(e.reason ?? '')}`;
      break;
    case 'error': outcome.innerHTML = `<span class="badge u-critical">error</span> ${esc(e.message)}`; break;
    case 'ended': {
      call.live = false;
      call.el.classList.remove('live');
      call.el.querySelector('.head .badge').outerHTML = '<span class="badge b-neutral">ended</span>';
      break;
    }
  }
  renderStats();
}

fetch('/api/config').then((r) => r.json()).then(({ models }) => {
  const label = ({ model, host }) => `${model}${model.includes('open') ? ' (open weights)' : ''} on ${host}`;
  $('models').textContent = `Conversation: ${label(models.conversation)} · Triage: ${label(models.triage)}`;
});

const events = new EventSource('/api/events');
events.onmessage = (msg) => {
  const e = JSON.parse(msg.data);
  if (e.kind === 'snapshot') {
    cases = new Map(e.cases.map((c) => [c.id, c]));
    callsAnswered = Math.max(callsAnswered, e.stats.callsAnswered);
    mergedCount = Math.max(mergedCount, e.stats.merged);
    if (!e.cases.length && !e.stats.callsAnswered) {
      for (const m of markers.values()) m.remove();
      markers.clear();
      calls.clear();
      mergedCount = 0;
      callsAnswered = 0;
      fitted = false;
      $('calls').innerHTML = '<div class="empty">Overflow calls appear here as the AI answers them.</div>';
    }
    renderQueue();
  } else if (e.kind === 'case') {
    if (e.type === 'reset') return;
    cases.set(e.case.id, e.case);
    renderQueue(e.case.id);
  } else if (e.kind === 'call') {
    onCallEvent(e);
  } else if (e.kind === 'surge') {
    $('surgeBtn').disabled = e.type !== 'surge-finished' && e.type !== 'surge-error';
    $('surgeBtn').textContent = e.type === 'surge-progress' ? `Flood night… ${e.done}/${e.calls}` : 'Simulate flood night';
  }
};

$('surgeBtn').onclick = () => fetch('/api/surge', { method: 'POST' });
$('resetBtn').onclick = () => fetch('/api/reset', { method: 'POST' });
setInterval(() => renderQueue(), 30000);

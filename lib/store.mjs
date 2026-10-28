import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const URGENCY_WEIGHT = { critical: 100, high: 60, medium: 30, low: 10 };
const URGENCY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

// Rescue priority. Urgency dominates; vulnerable people and headcount break ties;
// waiting time keeps rising so no open case is starved by newer ones.
export function priorityScore(c, now = Date.now()) {
  const waitingMin = (now - c.createdAt) / 60000;
  return Math.round(
    URGENCY_WEIGHT[c.urgency] + 6 * c.vulnerable.length + Math.min(c.headcountMax, 50) * 0.4 + Math.min(waitingMin, 120),
  );
}

export const higherUrgency = (a, b) => (URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b);

const JSON_COLUMNS = ['vulnerable', 'reports', 'missingInfo', 'notDuplicateOf'];

export class CaseStore extends EventEmitter {
  #db;

  constructor(path = ':memory:') {
    super();
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        status TEXT NOT NULL,          -- open | assigned | rescued | merged
        source TEXT NOT NULL,          -- call | surge | photo
        districtKey TEXT,
        area TEXT, landmark TEXT, district TEXT, place TEXT,
        lat REAL, lon REAL, approximate INTEGER,
        headcountMin INTEGER, headcountMax INTEGER, headcountConfirmed INTEGER,
        vulnerable TEXT, waterLevel TEXT, urgency TEXT,
        callback TEXT, summary TEXT, missingInfo TEXT,
        reports TEXT,                  -- [{at, source, transcript, callId}]
        mergedInto TEXT, assignedTeam TEXT, photoCount INTEGER,
        possibleDuplicateOf TEXT,
        notDuplicateOf TEXT,           -- [caseId] the caller said they are not part of
        photoEvidence TEXT
      )`);
  }

  #row(r) {
    if (!r) return null;
    const c = { ...r, approximate: !!r.approximate, headcountConfirmed: !!r.headcountConfirmed };
    for (const k of JSON_COLUMNS) c[k] = JSON.parse(r[k] ?? '[]');
    c.photoEvidence = r.photoEvidence ? JSON.parse(r.photoEvidence) : null;
    c.priority = priorityScore(c);
    c.needsCallback = c.status === 'open' && (!c.headcountMax || !c.area || !(c.landmark || c.place));
    return c;
  }

  reset() {
    this.#db.exec('DELETE FROM cases');
    this.emit('change', { type: 'reset' });
  }

  get(id) {
    return this.#row(this.#db.prepare('SELECT * FROM cases WHERE id = ?').get(id));
  }

  list({ includeClosed = false } = {}) {
    const rows = this.#db
      .prepare(includeClosed ? 'SELECT * FROM cases' : "SELECT * FROM cases WHERE status IN ('open','assigned')")
      .all();
    return rows.map((r) => this.#row(r)).sort((a, b) => b.priority - a.priority);
  }

  #nextId() {
    const { n } = this.#db.prepare('SELECT COUNT(*) AS n FROM cases').get();
    return `JR-${String(n + 1).padStart(4, '0')}`;
  }

  create(fields) {
    const now = Date.now();
    const c = {
      id: this.#nextId(),
      createdAt: now,
      updatedAt: now,
      status: 'open',
      source: 'call',
      districtKey: null,
      area: '',
      landmark: '',
      district: '',
      place: null,
      lat: null,
      lon: null,
      approximate: true,
      headcountMin: 0,
      headcountMax: 0,
      headcountConfirmed: false,
      vulnerable: [],
      waterLevel: 'unknown',
      urgency: 'low',
      callback: '',
      summary: '',
      missingInfo: [],
      reports: [],
      mergedInto: null,
      possibleDuplicateOf: null,
      notDuplicateOf: [],
      photoEvidence: null,
      assignedTeam: null,
      photoCount: 0,
      ...fields,
    };
    const cols = Object.keys(c);
    this.#db
      .prepare(`INSERT INTO cases (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map((k) => this.#encode(k, c[k])));
    const saved = this.get(c.id);
    this.emit('change', { type: 'created', case: saved });
    return saved;
  }

  update(id, patch, eventType = 'updated') {
    const fields = { ...patch, updatedAt: Date.now() };
    const cols = Object.keys(fields);
    this.#db
      .prepare(`UPDATE cases SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((k) => this.#encode(k, fields[k])), id);
    const saved = this.get(id);
    this.emit('change', { type: eventType, case: saved });
    return saved;
  }

  #encode(key, value) {
    if (JSON_COLUMNS.includes(key)) return JSON.stringify(value ?? []);
    if (key === 'photoEvidence') return value ? JSON.stringify(value) : null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value ?? null;
  }
}

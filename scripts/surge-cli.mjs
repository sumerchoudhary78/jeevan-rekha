// Runs the flood-night surge headless and scores duplicate merging against the scripted groups.
//   node --env-file=.env scripts/surge-cli.mjs [limit]
import { EventEmitter } from 'node:events';
import { CaseStore } from '../lib/store.mjs';
import { loadSurgeCalls, runSurge } from '../lib/surge.mjs';

const store = new CaseStore();
const bus = new EventEmitter();
const groupOf = Object.fromEntries(loadSurgeCalls().map((c) => [`sim-${c.id}`, c.group]));
bus.on('call', (e) => {
  if (e.type === 'opened' || e.type === 'merged') console.log(`${e.callId.padEnd(8)} ${(e.relation ?? e.type).padEnd(17)} -> ${e.caseId}${e.possibleDuplicateOf ? ' (possible dup of ' + e.possibleDuplicateOf + ')' : ''}  (${e.group})${e.reason ? '  ' + e.reason.slice(0, 140) : ''}`);
  if (e.type === 'error') console.log(`${e.callId} ERROR ${e.message}`);
});

const t0 = Date.now();
const stats = await runSurge({ store, bus, spacingMs: 300, limit: Number(process.argv[2]) || undefined });
console.log(`\n${stats.calls} calls in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${stats.merged} merged, ${stats.failed} failed`);

console.log('\nQueue (highest priority first):');
let wrongMerges = 0;
const groupsSeen = new Map();
for (const c of store.list()) {
  const groups = [...new Set(c.reports.map((r) => groupOf[r.callId]))];
  if (groups.length > 1) wrongMerges++;
  for (const g of groups) groupsSeen.set(g, (groupsSeen.get(g) ?? 0) + 1);
  console.log(`${String(c.priority).padStart(4)} ${c.id} ${c.urgency.padEnd(8)} ${String(c.headcountMin + '-' + c.headcountMax).padEnd(6)} ${c.place ?? c.area} [${c.vulnerable.join(',')}] reports=${c.reports.length} groups=${groups.join('+')}`);
}
const missedMerges = [...groupsSeen.values()].filter((n) => n > 1).length;
const flagged = store.list().filter((c) => c.possibleDuplicateOf && groupOf[c.reports[0].callId] === groupOf[store.get(c.possibleDuplicateOf).reports[0].callId]).length;
console.log(`flagged for human review (correctly) ${flagged}`);
console.log(`\ncases ${store.list().length} (expected ${new Set(Object.values(groupOf)).size}) | wrong merges ${wrongMerges} | groups split across cases ${missedMerges}`);

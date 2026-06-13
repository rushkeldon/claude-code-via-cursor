import * as path from 'path';
import * as fs from 'fs';
import { log } from './logger';

// Persistent toCursor handoff table.
//
// `/plans toCursor` copies a plan into ~/.cursor/plans/ AND archives the repo
// original into doc/archive/. That creates TWO files for one logical plan: the
// inert archived decoy and the live Cursor copy. The which-plan picker must
// suppress the decoy and surface the live copy — but the live copy lives OUTSIDE
// the project, and the mapping "this archived file ⇄ that Cursor copy is the same
// plan, and the Cursor one is canonical" is knowledge created at handoff time
// that must SURVIVE reload. So, unlike the ephemeral phase state, this table
// persists — in extension storage (private; does not travel with the repo).
//
// `target` is generic ('cursor' today) so a future toIntelliJ reuses the table.
// Reconcile-on-read: a row whose livePath no longer exists is dropped, never
// trusted — the same "verify against reality, don't trust a stale record" rule we
// learned the hard way elsewhere.

export interface HandoffRow {
	basename: string;       // e.g. "foo.plan.md"
	archivedPath: string;   // the inert decoy in doc/archive/
	target: string;         // 'cursor' | (future) 'intellij' | …
	livePath: string;       // the canonical live copy (e.g. ~/.cursor/plans/foo.plan.md)
	handedOffWhen: string;  // free description; not a timestamp anything depends on
}

let tablePath: string | undefined;

export function init(storagePath: string | undefined): void {
	if (!storagePath) { tablePath = undefined; return; }
	const dir = path.join(storagePath, 'plan-handoffs');
	try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }
	tablePath = path.join(dir, 'handoffs.json');
	log.debug('PlanHandoffs', 'init', { tablePath }, '🔧');
}

function readRaw(): HandoffRow[] {
	if (!tablePath) { return []; }
	try {
		const txt = fs.readFileSync(tablePath, 'utf8');
		const parsed = JSON.parse(txt);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeRaw(rows: HandoffRow[]): void {
	if (!tablePath) { return; }
	try {
		fs.writeFileSync(tablePath, JSON.stringify(rows, null, 2) + '\n', 'utf8');
	} catch (e: any) {
		log.error('PlanHandoffs', 'write failed', { error: e?.message ?? String(e) }, '💥');
	}
}

// List handoffs, RECONCILED: drop any row whose livePath no longer exists on disk
// (a manually-deleted/moved Cursor copy → stale row, don't surface it). Persists
// the pruned table so staleness doesn't accumulate.
export function list(): HandoffRow[] {
	const rows = readRaw();
	const live = rows.filter(r => {
		try { return fs.existsSync(r.livePath); } catch { return false; }
	});
	if (live.length !== rows.length) {
		log.debug('PlanHandoffs', 'reconcile dropped stale rows', { before: rows.length, after: live.length }, '🧹');
		writeRaw(live);
	}
	return live;
}

// Record (or replace) a handoff for a basename. Replacing on basename keeps the
// table from accumulating duplicates if the same plan is handed off again.
export function record(row: HandoffRow): void {
	const rows = readRaw().filter(r => r.basename !== row.basename);
	rows.push(row);
	writeRaw(rows);
	log.info('PlanHandoffs', 'recorded handoff', { basename: row.basename, livePath: row.livePath }, '📌');
}

// The set of archived decoy paths the picker should SUPPRESS, and a basename→live
// map so it can surface the live copy in their place. Both reconciled via list().
export function archivedPathsToSuppress(): Set<string> {
	return new Set(list().map(r => r.archivedPath));
}

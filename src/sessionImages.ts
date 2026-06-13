import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { log } from './logger';

// Conversation images are written to a single flat directory and associated with
// their conversation purely by a filename prefix: `<sessionId>_<name>`. That makes
// cleanup a filename glob — no conversation-JSON parsing — and robust even when the
// JSON is missing or malformed. Images attached before the CLI mints a session id
// use the `pending_` prefix and are renamed to `<sessionId>_` once init reports one.
export const IMG_DIR = path.join(
	os.homedir(),
	'Library',
	'Application Support',
	'claude-code-via-ide',
	'img',
);

const PENDING_PREFIX = 'pending_';

// Read the img dir, swallowing ENOENT (dir not created yet) and any other fs error
// so callers can iterate unconditionally.
function safeReaddir(): string[] {
	try {
		return fs.readdirSync(IMG_DIR);
	} catch {
		return [];
	}
}

// Rename within IMG_DIR, swallowing races. If the target already exists we leave the
// source in place — the orphan sweep will reclaim it later rather than clobbering.
function tryRename(from: string, to: string): void {
	if (from === to) { return; }
	try {
		const toPath = path.join(IMG_DIR, to);
		if (fs.existsSync(toPath)) {
			log.debug('SessionImages', 'rename target exists, leaving source', { from, to }, '⚠️');
			return;
		}
		fs.renameSync(path.join(IMG_DIR, from), toPath);
		log.debug('SessionImages', 'renamed image', { from, to }, '🔤');
	} catch {
		// Source already gone / dir missing — nothing to do.
	}
}

function tryUnlink(name: string): void {
	try {
		fs.unlinkSync(path.join(IMG_DIR, name));
		log.debug('SessionImages', 'deleted image', { name }, '🧹');
	} catch {
		// Already gone.
	}
}

// The session-id prefix of a filename is everything before the first underscore.
// Files with no underscore (shouldn't occur for our writes) yield ''.
function prefixOf(name: string): string {
	const i = name.indexOf('_');
	return i === -1 ? '' : name.slice(0, i);
}

// Pre-ID attach → real id minted at system/init. Promote any pending_* files to the
// freshly-assigned session id so they're correctly associated for later cleanup.
export function renamePendingImages(newId: string): void {
	if (!newId) { return; }
	for (const f of safeReaddir()) {
		if (f.startsWith(PENDING_PREFIX)) {
			tryRename(f, `${newId}_${f.slice(PENDING_PREFIX.length)}`);
		}
	}
}

// In-window session-id rotation (NOT a fork — forks are out-of-process and never
// touch this window's currentSessionId). Re-prefix the rotating session's images so
// delete-by-prefix and the sweep stay accurate.
export function renameSessionImages(oldId: string, newId: string): void {
	if (!oldId || !newId || oldId === newId) { return; }
	const oldPrefix = `${oldId}_`;
	for (const f of safeReaddir()) {
		if (f.startsWith(oldPrefix)) {
			tryRename(f, `${newId}_${f.slice(oldPrefix.length)}`);
		}
	}
}

// Delete every image belonging to a conversation, by its session-id prefix. Called
// when a conversation is deleted.
export function deleteSessionImages(sessionId: string | undefined): void {
	if (!sessionId) { return; }
	const prefix = `${sessionId}_`;
	let deleted = 0;
	for (const f of safeReaddir()) {
		if (f.startsWith(prefix)) {
			tryUnlink(f);
			deleted++;
		}
	}
	log.info('SessionImages', 'deleteSessionImages', { sessionId, deleted }, '🗑️');
}

// Age-gated orphan sweep, run once on activation after the conversation index loads.
// Deletes an image only if BOTH: (a) its session-id prefix matches no conversation in
// the index, AND (b) it is older than the oldest session still in history. The age
// gate protects freshly-attached pending_* and just-rotated files in a not-yet-indexed
// live chat — they're always newer than the oldest live session, so they're left alone.
// With an empty index, oldestLive is Infinity → every unmatched file is swept.
export function sweepOrphanImages(index: Array<{ sessionId: string; startTime: string }>): void {
	const liveIds = new Set(index.map(e => e.sessionId));
	const oldestLive = index.reduce<number>((min, e) => {
		const t = Date.parse(e.startTime);
		return isNaN(t) ? min : Math.min(min, t);
	}, Infinity);

	let swept = 0;
	for (const f of safeReaddir()) {
		if (liveIds.has(prefixOf(f))) { continue; }   // belongs to a live conversation
		let mtime: number;
		try {
			mtime = fs.statSync(path.join(IMG_DIR, f)).mtimeMs;
		} catch {
			continue;   // vanished mid-sweep
		}
		if (mtime >= oldestLive) { continue; }         // newer than oldest live session — leave it
		tryUnlink(f);
		swept++;
	}
	log.info('SessionImages', 'sweepOrphanImages', { swept, liveSessions: liveIds.size }, '🧹');
}

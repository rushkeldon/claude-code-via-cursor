// Cross-window single-writer guard.
//
// Within one Cursor window the extension already guarantees one live process per
// session (module-level state). But two separate windows are two extension hosts;
// if both `--resume` the same session id, their writes interleave and corrupt the
// transcript — and the CLI does NOT conflict-check the --resume path (Phase 0:
// --session-id only guards new-session minting, and `--resume --session-id` is
// rejected unless --fork-session is also passed). So we hand-roll a lockfile.
//
// A lock is a small JSON file keyed by session id under <storage>/locks/, holding
// the owning window's pid + a heartbeat timestamp. We refresh the heartbeat while
// we own a session; a lock whose heartbeat is stale (owning window crashed) counts
// as free so no session is ever permanently locked. The lock is PER SESSION ID —
// resuming a different session in another window is never blocked.
import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';

interface LockData {
	pid: number;
	heartbeatMs: number;
	acquiredMs: number;
}

const PID = process.pid;
// A heartbeat older than this means the owner is gone (crash / hard quit).
const STALE_MS = 30_000;
const HEARTBEAT_MS = 10_000;

let locksDir: string | undefined;
let ownedSessionId: string | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;

export function init(storagePath: string | undefined): void {
	if (!storagePath) { locksDir = undefined; return; }
	locksDir = path.join(storagePath, 'locks');
	try { fs.mkdirSync(locksDir, { recursive: true }); } catch { /* best-effort */ }
	log.debug('SessionLock', 'init', { locksDir }, '🔧');
}

function lockPath(sessionId: string): string | undefined {
	if (!locksDir) { return undefined; }
	// Session ids are UUIDs, but sanitize defensively so we never escape the dir.
	const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
	return path.join(locksDir, `${safe}.lock`);
}

function readLock(sessionId: string): LockData | undefined {
	const p = lockPath(sessionId);
	if (!p) { return undefined; }
	try {
		const raw = fs.readFileSync(p, 'utf8');
		const data = JSON.parse(raw) as LockData;
		if (typeof data?.pid === 'number' && typeof data?.heartbeatMs === 'number') {
			return data;
		}
	} catch { /* missing or unreadable → unlocked */ }
	return undefined;
}

function isStale(lock: LockData): boolean {
	return Date.now() - lock.heartbeatMs > STALE_MS;
}

// Is this session currently held by ANOTHER live window? (Our own lock, or a
// stale one, does not count as locked-against-us.)
export function isLockedByOther(sessionId: string | undefined): { locked: boolean; pid?: number } {
	if (!sessionId || !locksDir) { return { locked: false }; }
	const lock = readLock(sessionId);
	if (!lock) { return { locked: false }; }
	if (lock.pid === PID) { return { locked: false }; }       // ours
	if (isStale(lock)) { return { locked: false }; }          // owner gone
	return { locked: true, pid: lock.pid };
}

// Try to acquire the lock for a session we're about to (re)spawn. Returns false
// if another live window holds it. Idempotent for our own session.
export function acquire(sessionId: string | undefined): boolean {
	if (!sessionId || !locksDir) { return true; } // no storage → can't lock; allow
	const existing = readLock(sessionId);
	if (existing && existing.pid !== PID && !isStale(existing)) {
		log.warn('SessionLock', 'acquire denied — held by another window', { sessionId, pid: existing.pid }, '🔒');
		return false;
	}
	const p = lockPath(sessionId);
	if (!p) { return true; }
	const now = Date.now();
	const data: LockData = {
		pid: PID,
		heartbeatMs: now,
		acquiredMs: existing?.pid === PID ? existing.acquiredMs : now,
	};
	const payload = JSON.stringify(data);
	try {
		if (existing) {
			// We already verified it's ours or stale — safe to overwrite.
			fs.writeFileSync(p, payload, 'utf8');
		} else {
			// No existing lock — create exclusively to close the TOCTOU window
			// where two windows both pass the read-check in the same tick.
			try {
				fs.writeFileSync(p, payload, { encoding: 'utf8', flag: 'wx' });
			} catch (raceErr: any) {
				if (raceErr?.code === 'EEXIST') {
					// Another window won the race between our read and write.
					const winner = readLock(sessionId);
					if (winner && winner.pid !== PID && !isStale(winner)) {
						log.warn('SessionLock', 'acquire lost race', { sessionId, pid: winner.pid }, '🔒');
						return false;
					}
					// Winner is stale/ours after all — overwrite.
					fs.writeFileSync(p, payload, 'utf8');
				} else {
					throw raceErr;
				}
			}
		}
		ownedSessionId = sessionId;
		startHeartbeat();
		log.info('SessionLock', 'acquired', { sessionId }, '🔑');
		return true;
	} catch (e: any) {
		log.warn('SessionLock', 'acquire write failed (allowing)', { sessionId, error: e?.message ?? String(e) }, '⚠️');
		return true; // don't block the user on a lockfile write failure
	}
}

// Release the lock we hold (on kill / park / close / shutdown). Only deletes the
// file if WE own it, so we never stomp another window's lock.
export function release(sessionId?: string): void {
	const sid = sessionId ?? ownedSessionId;
	stopHeartbeat();
	if (!sid) { return; }
	const lock = readLock(sid);
	if (lock && lock.pid !== PID) {
		log.debug('SessionLock', 'release skipped — not our lock', { sessionId: sid, pid: lock.pid }, '🤷');
		return;
	}
	const p = lockPath(sid);
	if (p) {
		try { fs.unlinkSync(p); } catch { /* already gone */ }
	}
	if (ownedSessionId === sid) { ownedSessionId = undefined; }
	log.info('SessionLock', 'released', { sessionId: sid }, '🔓');
}

// Re-stamp the heartbeat for the currently-owned session so other windows see us
// as alive. Also rebinds if the session id changed (id rotation).
function startHeartbeat(): void {
	stopHeartbeat();
	heartbeatTimer = setInterval(() => {
		if (!ownedSessionId) { stopHeartbeat(); return; }
		const p = lockPath(ownedSessionId);
		if (!p) { return; }
		const existing = readLock(ownedSessionId);
		// If someone else took it (shouldn't happen while we're alive), back off.
		if (existing && existing.pid !== PID && !isStale(existing)) {
			log.warn('SessionLock', 'heartbeat — lock taken by another pid', { sessionId: ownedSessionId, pid: existing.pid }, '⚠️');
			return;
		}
		try {
			fs.writeFileSync(p, JSON.stringify({
				pid: PID,
				heartbeatMs: Date.now(),
				acquiredMs: existing?.acquiredMs ?? Date.now(),
			} as LockData), 'utf8');
		} catch { /* best-effort */ }
	}, HEARTBEAT_MS);
}

function stopHeartbeat(): void {
	if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = undefined; }
}

// When the live session id rotates (Phase 1.5), move our lock to the new id.
// Idempotent for the same id: we still (re-)acquire so the lockfile exists and
// the heartbeat is running even if a prior release() stopped it (e.g. after a
// settings restart that reuses the same id). NOT early-returning on equality is
// deliberate — see review bug #1 (lock/heartbeat desync).
export function rebind(newSessionId: string | undefined): void {
	if (!newSessionId) { return; }
	const prev = ownedSessionId;
	if (prev && prev !== newSessionId) { release(prev); }
	acquire(newSessionId);
}

// Return the set of session ids currently locked by ANOTHER live window, for
// badging the History list.
export function lockedSessionIds(): string[] {
	if (!locksDir) { return []; }
	const out: string[] = [];
	try {
		for (const name of fs.readdirSync(locksDir)) {
			if (!name.endsWith('.lock')) { continue; }
			const sid = name.slice(0, -'.lock'.length);
			const lock = readLock(sid);
			if (lock && lock.pid !== PID && !isStale(lock)) { out.push(sid); }
		}
	} catch { /* none */ }
	return out;
}

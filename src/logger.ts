// claude-code-via-cursor fork — file-based logger modeled after the
// ChatStore LogService.swift.
//
// Writes ISO-timestamped lines to a daily-rotated file at
//   ~/Library/Application Support/claude-code-via-cursor/Logs/
//     claude-code-via-cursor-YYYY-MM-DD.log
//
// Each line includes pid so multiple Cursor windows writing concurrently
// can be disambiguated (one extension host per window; O_APPEND on macOS
// makes small concurrent writes safe).
//
// 4 levels with default emojis (overridable per call):
//   debug → 📦
//   info  → ℹ️
//   warn  → ⚠️
//   error → ❌
//
// Auto-prunes log files older than 7 days on init.
//
// Best-effort writes: failures are swallowed so logging cannot crash the
// extension. Writes are async via Promise queue so the extension's hot
// path is never blocked on disk IO.
//
// NO LogOutputChannel — this is the only sink. Read with Textastic, tail,
// grep, whatever you like.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

type Level = 'debug' | 'info' | 'warn' | 'error';

// MicBoom-style: emoji describes the EVENT, not the level. Each call site
// passes its own emoji that conveys what just happened. Level (DEBUG/INFO/
// WARN/ERROR) is conveyed by the text column. No per-level defaults.

const PAD: Record<Level, string> = {
	debug: 'DEBUG',
	info:  'INFO ',
	warn:  'WARN ',
	error: 'ERROR',
};

const RETENTION_DAYS = 7;
const PID = process.pid;

// Reasonable default cap for any single value rendered into a log line.
// Strings longer than this get truncated with an ellipsis; objects are
// serialized then truncated.
const MAX_VALUE_LEN = 200;

function logsDir(): string {
	const dir = path.join(
		os.homedir(),
		'Library',
		'Application Support',
		'claude-code-via-cursor',
		'Logs',
	);
	try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }
	return dir;
}

function todayUtc(): string {
	const d = new Date();
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function logFilePath(): string {
	return path.join(logsDir(), `claude-code-via-cursor-${todayUtc()}.log`);
}

// Clamp any value to a printable string ≤ MAX_VALUE_LEN. Strings just get
// length-clamped; objects get JSON-stringified then clamped. Anything that
// can't serialize falls back to its String() form.
export function truncate(value: any, maxLen: number = MAX_VALUE_LEN): string {
	if (value === undefined) { return 'undefined'; }
	if (value === null) { return 'null'; }
	let s: string;
	if (typeof value === 'string') {
		s = value;
	} else {
		try { s = JSON.stringify(value); }
		catch { s = String(value); }
	}
	if (s.length > maxLen) { return s.slice(0, maxLen) + '…'; }
	return s;
}

// Build a "key=value key=value" tail for a log line. Each value is
// truncate-clamped. Order is insertion order of the object.
function fmtKV(obj?: Record<string, any>): string {
	if (!obj) { return ''; }
	const parts: string[] = [];
	for (const k of Object.keys(obj)) {
		const v = obj[k];
		// Strings get quoted so spaces/punctuation parse predictably.
		const tv = truncate(v);
		const needsQuote = typeof v === 'string' || (typeof v === 'object' && v !== null);
		parts.push(needsQuote ? `${k}="${tv}"` : `${k}=${tv}`);
	}
	return parts.length ? ' ' + parts.join(' ') : '';
}

// Serial write queue. Promise-chain ensures FIFO order even if a write
// stalls. Per-call appendFile is fine because we don't need a long-lived
// FileHandle — Node opens/closes the FD per call with O_APPEND semantics
// which is atomic for small lines on macOS.
let writeChain: Promise<void> = Promise.resolve();

function enqueueWrite(line: string): void {
	writeChain = writeChain.then(() =>
		new Promise<void>((resolve) => {
			fs.appendFile(logFilePath(), line + '\n', { encoding: 'utf8' }, () => resolve());
		})
	);
}

function emit(level: Level, subsystem: string, message: string, data?: Record<string, any>, emoji?: string): void {
	const ts = new Date().toISOString();
	// When no emoji is provided, render a single space so columns still align.
	const e = emoji && emoji.length > 0 ? emoji : ' ';
	const line = `${ts} ${e} ${PAD[level]} [pid=${PID} ${subsystem}] ${message}${fmtKV(data)}`;
	enqueueWrite(line);
}

// Public API — mirrors ChatStore's LogService signatures.
//
// Examples:
//   log.info('Profile', 'profile read', { profile, healthy });
//   log.warn('AuthDetect', 'auth pattern matched', { snippet });
//   log.error('ClaudeProcess', 'spawn failed', { error: e?.message });
//   log.debug('StreamParser', 'enter', { eventType: jsonData?.type });
export const log = {
	debug: (subsystem: string, message: string, data?: Record<string, any>, emoji?: string) =>
		emit('debug', subsystem, message, data, emoji),
	info: (subsystem: string, message: string, data?: Record<string, any>, emoji?: string) =>
		emit('info', subsystem, message, data, emoji),
	warn: (subsystem: string, message: string, data?: Record<string, any>, emoji?: string) =>
		emit('warn', subsystem, message, data, emoji),
	error: (subsystem: string, message: string, data?: Record<string, any>, emoji?: string) =>
		emit('error', subsystem, message, data, emoji),
};

// Prune log files older than RETENTION_DAYS. Called once from activate().
function pruneOldLogs(): void {
	try {
		const dir = logsDir();
		const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
		const items = fs.readdirSync(dir);
		let deleted = 0;
		for (const name of items) {
			if (!name.startsWith('claude-code-via-cursor-') || !name.endsWith('.log')) { continue; }
			const full = path.join(dir, name);
			try {
				const stat = fs.statSync(full);
				if (stat.mtimeMs < cutoffMs) {
					fs.unlinkSync(full);
					deleted++;
				}
			} catch { /* skip */ }
		}
		if (deleted > 0) {
			emit('info', 'Logger', `pruned ${deleted} old log file(s)`, { retentionDays: RETENTION_DAYS }, '🧹');
		}
	} catch (e: any) {
		emit('warn', 'Logger', 'pruneOldLogs failed', { error: e?.message ?? String(e) });
	}
}

// Returns the directory and current-day filename for reveal-in-Finder
// commands or bash-function reference.
export function getLogPaths(): { dir: string; file: string } {
	return { dir: logsDir(), file: logFilePath() };
}

// initLogger is intentionally minimal — the file is opened on first write
// (no explicit open ceremony needed). This kicks off pruning and writes a
// prominent session-start banner. Version is passed in by activate() so
// the very first line of every session announces which build is running.
export function initLogger(opts?: { version?: string; mode?: string; }): void {
	pruneOldLogs();
	const v = opts?.version ?? '(unknown)';
	const mode = opts?.mode ?? '(unknown)';
	// Two-line banner: first line is high-visibility for grepping; second
	// line carries the runtime context.
	emit('info', 'Logger', `═══ Claude Code via Cursor — v${v} (${mode}) ═══`, undefined, '🚀');
	emit('info', 'Logger', 'session start', {
		version: v,
		mode,
		pid: PID,
		file: logFilePath(),
		platform: process.platform,
		nodeVersion: process.version,
	}, '🌱');
}

// Convenience: a typed handle for the LogPaths so callers don't have to
// remember the export shape.
export type LogPaths = ReturnType<typeof getLogPaths>;

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as path from 'path';
import { log } from './logger';
import * as tokenCounters from './tokenCounters';
import * as conversation from './conversation';
import * as permissions from './permissions';
import * as backupRepo from './backupRepo';
import * as settings from './settings';
import * as terminalCommands from './terminalCommands';
import * as sessionLock from './sessionLock';
import { TITLE_PROMPT, sanitizeTitle } from './sessionTitle';
import { renamePendingImages, renameSessionImages } from './sessionImages';

const exec = util.promisify(cp.exec);

type PostMessageFn = (message: any) => void;

interface SubprocessDeps {
	postMessage: PostMessageFn;
	getStoragePath: () => string | undefined;
	getGlobalState: () => vscode.Memento;
}

let deps: SubprocessDeps | undefined;
let currentClaudeProcess: cp.ChildProcess | undefined;
let abortController: AbortController | undefined;
let isWslProcess: boolean = false;
let wslDistro: string = 'Ubuntu';
let isProcessing: boolean | undefined;

// ── Single-process reuse state ────────────────────────────────────────────
// One long-lived `claude` per session, kept warm across turns. The process is
// spawned lazily on the first turn (or when a respawn is required) and reused
// thereafter — we never respawn or stdin.end() per turn.
//
// `spawnedPlanMode` records the --permission-mode the live process was spawned
// with. Plan mode is a spawn-time arg, so toggling it between turns forces a
// respawn (with --resume) rather than a reuse.
let spawnedPlanMode: boolean | undefined;
// Signature of the thinking prefs (effort/thoughts) the live process was spawned
// with. These ride in spawn-time --settings, so changing them forces a respawn
// (with --resume) on the next turn. Model is excluded — it switches in-band.
let spawnedThinkingSig: string | undefined;
// Turns that arrived while a turn was already in flight; flushed at turn end.
// Each entry carries a stable `id` (monotonic counter) so the UI can target a
// specific queued item for cancel without ambiguity.
let queuedTurns: Array<{
	id: string;
	message: string;
	planMode?: boolean;
	images?: Array<string | { filePath: string; previewUri?: string }>;
}> = [];
let queueSeq = 0;

// Emit the current queue to the webview. Called at every queuedTurns mutation
// (enqueue / drain / cancel / clear) so the peeking QueuedPrompt card stays in
// sync. preview is a generous slice (CSS ellipsizes it to fit); hasImages flags
// an attachment. Exported so the webview can resync on (re)mount via webviewReady.
export function emitQueueState(): void {
	if (!deps) { return; }
	deps.postMessage({
		type: 'queueState',
		data: {
			items: queuedTurns.map(t => ({
				id: t.id,
				// Send a generous slice (not a tight 80) so the queued-prompt card's
				// CSS handles the visible truncation with a real ellipsis at whatever
				// the pane width is. The cap just bounds the payload, it's not the
				// display length — .queued-prompt-text clips + ellipsizes via flex.
				preview: (t.message || '').replace(/\s+/g, ' ').trim().slice(0, 200),
				hasImages: !!t.images?.length,
			})),
		},
	});
}

// ── Per-process stdout/stderr + auth/stall state ──────────────────────────
// These accumulate for the life of the warm process (reset on each spawn), not
// per turn — the stream is continuous across turns on one process.
let rawOutput = '';
let errorOutput = '';
// The CLI's `total_cost_usd` on each `result` is CUMULATIVE for the life of the
// warm process, not the cost of one turn. We bill the per-turn DELTA against this
// baseline (see the result handler), and reset it to 0 on every spawn because a
// fresh process restarts its cumulative at ~0. Without the delta, adding the raw
// cumulative every turn compounds the cost quadratically (the $418-vs-$80 bug).
let lastProcessCumulativeCost = 0;
let authErrorFired = false;

// ── Stall watchdog (module-scoped; armed only during an active turn) ───────
// Lives across the warm process's lifetime but only runs while a turn is in
// flight (armed on send, disarmed on result/abort) so it never SIGTERMs a
// warm-but-idle process sitting between turns.
let stallTimer: NodeJS.Timeout | undefined;
let lastStdoutMs = 0;
let stallNotified = false;
let stallKilled = false;
const STALL_NOTIFY_MS = 30_000;
const STALL_AUTOCONTINUE_MS = 60_000;
const STALL_KILL_MS = 120_000;

// ── Auto-continue (dropped-turn recovery) state ────────────────────────────
// A turn can stop producing output without ever emitting a terminal `result`
// (the stream goes quiet mid-turn). When that happens we inject ONE invisible
// "Continue from where you left off." to nudge the turn back to life, capped so
// we never loop. These are per-turn and reset at turn start / onTurnEnd.
const AUTO_CONTINUE_MAX = 1;
let autoContinueCount = 0;
// True while a tool_use has been seen but its tool_result hasn't arrived — the
// claude stream is legitimately silent during a long bash/web call, so the 60s
// auto-continue is suppressed (the 120s kill still applies — a wedged tool is
// worth killing).
let toolInFlight = false;
// True when the most recent `result` ended on a genuine error (is_error / auth /
// refusal). We must NOT auto-continue a known-bad end — that would re-trigger the
// same failure in a loop.
let lastResultWasError = false;
// True once we've shown the "stalled, couldn't recover" escalation card for the
// current turn, so it's surfaced at most once. Reset with the other per-turn state.
let autoContinueEscalated = false;

// ── Outbound control protocol ─────────────────────────────────────────────
// We send control_requests (initialize, set_model, interrupt, …) to the live
// process and correlate the matching control_response by request_id. Each
// request gets a Promise that resolves with the response body (or rejects on
// error/timeout). Mirrors the inbound control_request path in permissions.ts.
interface PendingControl {
	resolve: (response: any) => void;
	reject: (err: Error) => void;
	timer: NodeJS.Timeout;
}
let controlSeq = 0;
const pendingControl: Map<string, PendingControl> = new Map();
const CONTROL_TIMEOUT_MS = 15_000;
// Cached from the most recent initialize handshake; surfaced to the UI.
let cachedModels: any[] | undefined;
let cachedCommands: any[] | undefined;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
const IMAGE_MEDIA_TYPES: Record<string, string> = {
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml'
};

const AUTH_PATTERNS: RegExp[] = [
	/not authenticated/i,
	/please (run )?[`"']?claude\s*\/?\s*login/i,
	/session (has |is )?expired/i,
	/authentication (failed|required|expired)/i,
	/\bunauthorized\b/i,
	/invalid (api )?key/i,
	/oauth.*(expired|invalid|failed|revoked)/i,
	/\b401\b/,
];

export function init(d: SubprocessDeps): void {
	log.info('Subprocess', 'init', { hasPostMessage: !!d.postMessage }, '🔧');
	deps = d;
}

let silentQueryCallback: ((text: string) => void) | null = null;
let userRequestedStop = false;

// Set when the user deliberately pauses the current session by navigating away —
// clicking + (new session) or resuming a different conversation from History.
// Both tear down the live process via killProcess(), which aborts the in-flight
// turn and fires proc.on('error') with "The operation was aborted". That abort is
// expected, not a failure, so when this flag is set we render a friendly yellow
// notice instead of the red error card, then clear it. Mirrors userRequestedStop.
let userPausedSession: { reason: 'new-session' | 'history' } | null = null;

export function markUserPaused(reason: 'new-session' | 'history'): void {
	userPausedSession = { reason };
}

// True while a deliberate respawn is in progress (plan-mode toggle, thinking
// signature change, etc.). killProcess() will fire proc.on('error') with an
// AbortError — that's expected, not a failure, so the error handler swallows it
// silently when this flag is set. Cleared once the new process spawns. Mirrors
// userPausedSession but for "we're tearing this down on purpose to replace it"
// rather than "the user navigated away."
let respawnInProgress = false;

// True when an error is the result of an aborted operation (the signal raised by
// killProcess → abortController.abort()), so we can distinguish a deliberate
// pause from a genuine spawn/runtime failure.
function isAbortError(error: Error): boolean {
	return /aborted/i.test(error.message) || (error as any)?.name === 'AbortError';
}

// True from when a silent query is written to stdin until its `result` event
// reaches onTurnEnd. The silentQueryCallback fires earlier (on the assistant
// TEXT block), so it cannot be the signal that gates onTurnEnd — this flag is
// cleared inside onTurnEnd's guard, on the result event, so a silent-query
// completion is excluded from the queue-drain / deferred-switch logic.
let awaitingSilentResult = false;

export function isActive(): boolean {
	return !!isProcessing;
}

export function isSilentQueryInFlight(): boolean {
	return silentQueryCallback !== null;
}

export function clearSilentQuery(): void {
	silentQueryCallback = null;
	// Also clear the result-guard flag so a silent query abandoned mid-flight
	// (process killed before its `result` arrived) can't wrongly guard the next
	// real turn's onTurnEnd.
	awaitingSilentResult = false;
}

let pendingSilentQuery: { message: string; callback: (response: string) => void } | null = null;

export function sendSilentQuery(message: string, callback: (response: string) => void): void {
	if (!deps || !currentClaudeProcess?.stdin) {
		callback('');
		return;
	}
	if (isProcessing) {
		pendingSilentQuery = { message, callback };
		return;
	}
	silentQueryCallback = callback;
	awaitingSilentResult = true;
	const userMessage = {
		type: 'user',
		session_id: conversation.getCurrentSessionId() || '',
		message: { role: 'user', content: [{ type: 'text', text: message }] },
		parent_tool_use_id: null
	};
	currentClaudeProcess.stdin.write(JSON.stringify(userMessage) + '\n');
}

export function flushPendingSilentQuery(): void {
	if (pendingSilentQuery && currentClaudeProcess?.stdin && !isProcessing) {
		const { message, callback } = pendingSilentQuery;
		pendingSilentQuery = null;
		sendSilentQuery(message, callback);
	}
}

// Whether the dropped-turn auto-continue is enabled (setting, default on).
function autoContinueEnabled(): boolean {
	try {
		return vscode.workspace
			.getConfiguration('claudeCodeChat')
			.get<boolean>('autoContinue', true);
	} catch {
		return true;
	}
}

// Invisible recovery nudge for a dropped turn (see the stall watchdog). The turn
// went quiet mid-stream without a terminal `result`; write one "continue" user
// message straight to stdin to resume it. Deliberately does NOT reuse
// sendSilentQuery (which early-returns while isProcessing and routes through the
// awaitingSilentResult guard) and does NOT touch isProcessing / the queue / the
// UX — the original turn is still in flight; we're resuming it, not starting a new
// one. Re-arms the watchdog so the resumed turn gets a fresh silence window; the
// autoContinueCount cap (incremented by the caller) prevents looping.
function injectContinue(): void {
	if (!currentClaudeProcess?.stdin) { return; }
	const userMessage = {
		type: 'user',
		session_id: conversation.getCurrentSessionId() || '',
		message: { role: 'user', content: [{ type: 'text', text: 'Continue from where you left off.' }] },
		parent_tool_use_id: null
	};
	currentClaudeProcess.stdin.write(JSON.stringify(userMessage) + '\n');
	log.info('Subprocess', 'auto-continue nudge injected', undefined, '↩️');
	// Drop the "still working" hint and give the resumed turn a fresh window.
	if (stallNotified) {
		stallNotified = false;
		deps?.postMessage({ type: 'stallHintClear' });
	}
	armStallWatchdog();
}

export function getProcess(): cp.ChildProcess | undefined {
	return currentClaudeProcess;
}

export function convertToWSLPath(windowsPath: string): string {
	log.debug('Subprocess', 'enter convertToWSLPath', { windowsPath }, '➡️');
	const config = vscode.workspace.getConfiguration('claudeCodeChat');
	const wslEnabled = config.get<boolean>('wsl.enabled', false);

	if (wslEnabled && windowsPath.match(/^[a-zA-Z]:/)) {
		const converted = windowsPath.replace(/^([a-zA-Z]):/, '/mnt/$1').toLowerCase().replace(/\\/g, '/');
		log.debug('Subprocess', 'exit convertToWSLPath — converted', { converted }, '⬅️');
		return converted;
	}

	log.debug('Subprocess', 'exit convertToWSLPath — unchanged', undefined, '⬅️');
	return windowsPath;
}

// ── Outbound control protocol ─────────────────────────────────────────────

// Send a control_request to the live process and resolve with the response
// body when the matching control_response arrives (correlated by request_id).
// Rejects if there is no live stdin, on a control error response, or on timeout.
export function sendControlRequest(subtype: string, payload: Record<string, any> = {}): Promise<any> {
	const stdin = currentClaudeProcess?.stdin;
	if (!stdin || stdin.destroyed) {
		return Promise.reject(new Error(`no live process for control_request "${subtype}"`));
	}
	const requestId = `cc-${++controlSeq}`;
	const msg = {
		type: 'control_request',
		request_id: requestId,
		request: { subtype, ...payload },
	};
	return new Promise<any>((resolve, reject) => {
		const timer = setTimeout(() => {
			pendingControl.delete(requestId);
			reject(new Error(`control_request "${subtype}" timed out after ${CONTROL_TIMEOUT_MS}ms`));
		}, CONTROL_TIMEOUT_MS);
		pendingControl.set(requestId, { resolve, reject, timer });
		try {
			stdin.write(JSON.stringify(msg) + '\n');
			log.debug('Subprocess', 'control_request sent', { requestId, subtype }, '📤');
		} catch (e: any) {
			clearTimeout(timer);
			pendingControl.delete(requestId);
			reject(new Error(`failed to write control_request "${subtype}": ${e?.message ?? String(e)}`));
		}
	});
}

// Route an inbound control_response to its pending sender. The CLI wraps the
// payload as { response: { subtype: 'success'|'error', request_id, response?, error? } }.
function handleControlResponse(jsonData: any): void {
	const r = jsonData?.response ?? {};
	const requestId = r.request_id;
	const pending = requestId ? pendingControl.get(requestId) : undefined;
	if (!pending) {
		log.debug('Subprocess', 'control_response with no pending sender', { requestId, subtype: r.subtype }, '🤷');
		return;
	}
	clearTimeout(pending.timer);
	pendingControl.delete(requestId);
	if (r.subtype === 'error' || r.error) {
		const errMsg = typeof r.error === 'string' ? r.error : JSON.stringify(r.error ?? 'control_request rejected');
		log.warn('Subprocess', 'control_response error', { requestId, errMsg }, '⚠️');
		pending.reject(new Error(errMsg));
		return;
	}
	log.debug('Subprocess', 'control_response resolved', { requestId, subtype: r.subtype }, '📥');
	pending.resolve(r.response ?? {});
}

// Reject and clear every in-flight control_request (process died / restarting).
function rejectAllPendingControl(reason: string): void {
	for (const [, p] of pendingControl) {
		clearTimeout(p.timer);
		try { p.reject(new Error(reason)); } catch { /* ignore */ }
	}
	pendingControl.clear();
}

// Public entry. Under the single-process reuse model this is an ENTRY GUARD:
// if a turn is already in flight we queue the message and flush it at turn end
// (onTurnEnd) — we never spawn a second child. Otherwise we run the turn,
// reusing the warm process if one exists (or spawning lazily if not).
export async function sendMessage(message: string, planMode?: boolean, images?: Array<string | { filePath: string; previewUri?: string }>): Promise<void> {
	if (!deps) { return; }

	log.info('ClaudeProcess', 'sendMessage', {
		textLen: message?.length,
		text: message,
		planMode: !!planMode,
		imageCount: images?.length ?? 0,
		model: settings.getSelectedModel(),
		session: conversation.getCurrentSessionId(),
		processing: !!isProcessing,
		hasLiveProcess: !!currentClaudeProcess,
	}, '💬');

	if (isProcessing) {
		// A turn is already in flight — queue rather than spawn a second child.
		queuedTurns.push({ id: `q-${++queueSeq}`, message, planMode, images });
		log.info('ClaudeProcess', 'turn queued (turn in flight)', { queueLen: queuedTurns.length }, '⏸️');
		emitQueueState();
		return;
	}

	await runTurn({ message, planMode, images });
}

interface Turn {
	message: string;
	planMode?: boolean;
	images?: Array<string | { filePath: string; previewUri?: string }>;
}

async function runTurn(turn: Turn): Promise<void> {
	if (!deps) { return; }
	const { message, planMode, images } = turn;

	// Thinking depth/visibility is controlled by the Effort/Thoughts pickers via
	// launch-injected --settings — not by prompt-prefix magic words. (The old
	// THINK/ULTRATHINK prefix only steered legacy models and did nothing on Opus
	// 4.6+; effort is the real dial now.)
	const actualMessage = message;

	isProcessing = true;

	const echoImages = (images || []).map(img =>
		typeof img === 'string' ? { filePath: img } : { filePath: img.filePath, previewUri: img.previewUri }
	);
	conversation.sendAndSaveMessage({
		type: 'userInput',
		data: message,
		images: echoImages.length > 0 ? echoImages : undefined
	});

	deps.postMessage({
		type: 'setProcessing',
		data: { isProcessing: true }
	});

	try {
		await backupRepo.createBackupCommit(message);
	}
	catch (e: any) {
		log.error('Subprocess', 'backupRepo.createBackupCommit failed', { error: e?.message ?? String(e) }, '💥');
	}

	deps.postMessage({
		type: 'loading',
		data: 'Claude is working...'
	});

	// Decide spawn-vs-reuse. We (re)spawn only when there is no usable live
	// process, or when plan mode changed (it is a spawn-time --permission-mode
	// arg, so toggling it requires a fresh process — resumed via --resume).
	const stdinUsable = !!currentClaudeProcess?.stdin && !currentClaudeProcess.stdin.destroyed;
	const planModeChanged = !!planMode !== !!spawnedPlanMode;
	// Effort/Thoughts changed since spawn → respawn to re-inject --settings.
	const thinkingChanged = !!currentClaudeProcess && spawnedThinkingSig !== settings.getThinkingSig();
	const needSpawn = !currentClaudeProcess || !stdinUsable || planModeChanged || thinkingChanged;

	if (needSpawn) {
		if (currentClaudeProcess) {
			// Stale/closing handle or a plan-mode toggle — reap before respawn so
			// we never have two children attached to the same session at once.
			// killProcess() clears queuedTurns (correct for an explicit stop), but
			// here we're mid-drain — preserve any turns still waiting behind this one.
			log.info('ClaudeProcess', 'respawn required', { planModeChanged, thinkingChanged, stdinUsable }, '♻️');
			const preserved = queuedTurns;
			// Mark the abort that killProcess() is about to raise as expected, so
			// proc.on('error') swallows it silently instead of painting a red card.
			respawnInProgress = true;
			await killProcess();
			queuedTurns = preserved;
		}
		const ok = await spawnProcess(!!planMode);
		if (!ok) {
			// Synchronous spawn failure — don't leave the turn stuck "processing".
			// Also clear the respawn flag so a real future error isn't silently
			// swallowed (the success path clears it inside spawnProcess; this is
			// the failure-path counterpart).
			respawnInProgress = false;
			isProcessing = false;
			disarmStallWatchdog();
			deps.postMessage({ type: 'setProcessing', data: { isProcessing: false } });
			return;
		}
	} else {
		log.info('ClaudeProcess', 'reusing warm process', { pid: currentClaudeProcess?.pid }, '🔥');
	}

	const wrote = await writeUserTurn(actualMessage, images);
	if (!wrote) {
		// Nothing was sent — no `result` will arrive to end the turn, so reset
		// here rather than leave the UI stuck "working".
		isProcessing = false;
		disarmStallWatchdog();
		deps.postMessage({ type: 'setProcessing', data: { isProcessing: false } });
		return;
	}
	// Fresh turn → reset the per-turn auto-continue state (a prior turn's error or
	// spent nudge must not carry over and block/skew recovery for this one).
	autoContinueCount = 0;
	autoContinueEscalated = false;
	toolInFlight = false;
	lastResultWasError = false;
	armStallWatchdog();
}

// Spawn one long-lived `claude` for this session and wire its handlers. Returns
// false if the spawn could not be performed. --resume is included ONLY here, and
// only when resuming an existing session (we never pass --resume per turn).
async function spawnProcess(planMode: boolean): Promise<boolean> {
	if (!deps) { return false; }

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : process.cwd();

	const args = [
		'--output-format', 'stream-json',
		'--input-format', 'stream-json',
		'--include-partial-messages',
		'--verbose'
	];

	const config = vscode.workspace.getConfiguration('claudeCodeChat');

	// Always route tool permissions through the stdio prompt tool — never
	// --dangerously-skip-permissions. The skip flag suppresses can_use_tool
	// control requests entirely, which also suppresses the AskUserQuestion
	// interactive card (the extension intercepts it via that same channel in
	// permissions.handleControlRequest). YOLO mode is instead enforced at the
	// extension layer: permissions.ts auto-approves every tool when yoloMode is
	// on, while still surfacing AskUserQuestion as an interactive prompt.
	args.push('--permission-prompt-tool', 'stdio');

	const storagePath = deps.getStoragePath();
	const mcpConfigPath = storagePath ? path.join(storagePath, 'mcp', 'mcp-servers.json') : undefined;
	if (mcpConfigPath) {
		try {
			await vscode.workspace.fs.stat(vscode.Uri.file(mcpConfigPath));
			args.push('--mcp-config', convertToWSLPath(mcpConfigPath));
		} catch {
			// File doesn't exist, skip --mcp-config
		}
	}

	if (planMode) {
		args.push('--permission-mode', 'plan');
	}

	// Launch-injection from extension-owned storage (build-to-contract). --model
	// overrides settings.local.json; --settings injects the advertised thinking
	// keys (gated on the selected model's capabilities). We write NOTHING to the
	// dev's settings.local.json — it stays for "Claude Code in the wild". On every
	// respawn this re-applies the same prefs, so an in-band model switch is never
	// reverted (the model-revert bug). 'default' is the account default sentinel —
	// don't pass --model for it (let the CLI resolve the configured default).
	const injectedModel = settings.getSelectedModel();
	if (injectedModel && injectedModel !== 'default') {
		args.push('--model', injectedModel);
	}
	const thinkingSettings = settings.buildThinkingSettingsArg(getCachedModels(), injectedModel);
	if (thinkingSettings) {
		args.push('--settings', thinkingSettings);
	}

	// --resume ONLY at spawn, and only when resuming an existing session. A
	// brand-new session spawns without --resume; the CLI mints the id and we
	// adopt the latest reported session_id (system/init + result) thereafter.
	const sessionId = conversation.getCurrentSessionId();
	if (sessionId) {
		// Cross-window guard: don't attach a second process to a session another
		// live window already owns (bare --resume does not conflict-check, so this
		// is our lock). The user can wait or Fork from History instead.
		if (!sessionLock.acquire(sessionId)) {
			const { pid: lockedBy } = sessionLock.isLockedByOther(sessionId);
			log.warn('Subprocess', 'spawn blocked — session locked by another window', { sessionId, lockedBy }, '🔒');
			isProcessing = false;
			deps.postMessage({ type: 'setProcessing', data: { isProcessing: false } });
			deps.postMessage({ type: 'clearLoading' });
			deps.postMessage({ type: 'sessionLocked', data: { sessionId, lockedBy } });
			return false;
		}
		args.push('--resume', sessionId);
	}

	const wslEnabled = config.get<boolean>('wsl.enabled', false);
	const wslDistroConfig = config.get<string>('wsl.distro', 'Ubuntu');
	const nodePath = config.get<string>('wsl.nodePath', '');
	const claudePath = config.get<string>('wsl.claudePath', '/usr/local/bin/claude');
	const customExecutablePath = config.get<string>('executable.path', '');
	const envsDisabled = config.get<boolean>('environment.disabled', false);
	const customEnvVars = envsDisabled ? {} : config.get<Record<string, string>>('environment.variables', {});

	let claudeProcess: cp.ChildProcess;

	abortController = new AbortController();

	let spawnEnv: NodeJS.ProcessEnv = {
		...process.env,
		FORCE_COLOR: '0',
		NO_COLOR: '1',
		...customEnvVars,
		CLAUDE_CODE_ENTRYPOINT: 'claude-vscode'
	};

	if (wslEnabled) {
		const wslEnvOverrides: Record<string, string> = { ...customEnvVars };
		wslEnvOverrides['CLAUDE_CODE_ENTRYPOINT'] = 'claude-vscode';
		const envExports = Object.entries(wslEnvOverrides)
			.map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
			.join(' && ');
		const envPrefix = envExports ? envExports + ' && ' : '';

		const wslCommand = envPrefix + terminalCommands.buildWslClaudeCommand(nodePath, claudePath, args);

		isWslProcess = true;
		wslDistro = wslDistroConfig;

		claudeProcess = cp.spawn('wsl', ['-d', wslDistroConfig, 'bash', '-ic', wslCommand], {
			signal: abortController.signal,
			detached: process.platform !== 'win32',
			cwd: cwd,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: spawnEnv
		});
	} else {
		isWslProcess = false;

		const executable = customExecutablePath || 'claude';
		claudeProcess = cp.spawn(executable, args, {
			signal: abortController.signal,
			shell: process.platform === 'win32' && !customExecutablePath,
			detached: process.platform !== 'win32',
			cwd: cwd,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: spawnEnv
		});
	}

	currentClaudeProcess = claudeProcess;
	spawnedPlanMode = planMode;
	spawnedThinkingSig = settings.getThinkingSig();

	// Reset per-process accumulators (the stream is continuous across turns on
	// this process; these belong to the process, not the turn).
	rawOutput = '';
	errorOutput = '';
	authErrorFired = false;
	// Fresh process → its total_cost_usd restarts at ~0, so the cost-delta
	// baseline must restart too (else the first result computes a bogus delta
	// against the prior process's final cumulative).
	lastProcessCumulativeCost = 0;
	// New process is live — the deliberate-respawn abort window is closed; a real
	// future error from this proc must not be silently swallowed.
	respawnInProgress = false;

	log.info('ClaudeProcess', 'spawned', { pid: claudeProcess.pid, planMode, resumed: !!sessionId }, '🚀');

	// Identity handle: the close/error handlers below capture `proc` and bail if
	// `currentClaudeProcess` is no longer this exact child — so a late-exiting
	// orphan (e.g. one we just killed for a respawn) can't null the live handle
	// or flip isProcessing out from under the current turn.
	const proc = claudeProcess;

	const fireAuthError = (rawSnippet: string) => {
		if (authErrorFired) { return; }
		authErrorFired = true;
		log.warn('AuthDetection', 'authError fired', { rawSnippet: rawSnippet.trim() }, '🔐');
		deps!.postMessage({
			type: 'authError',
			data: { rawError: rawSnippet.trim().slice(0, 800) }
		});
		try { proc.kill('SIGTERM'); } catch { /* already dead */ }
	};

	if (proc.stdout) {
		proc.stdout.on('data', (data) => {
			lastStdoutMs = Date.now();
			rawOutput += data.toString();

			const lines = rawOutput.split('\n');
			rawOutput = lines.pop() || '';

			for (const line of lines) {
				if (line.trim()) {
					try {
						const jsonData = JSON.parse(line.trim());

						if (jsonData.type === 'control_request') {
							permissions.handleControlRequest(jsonData).catch((err: any) => {
								log.error('Subprocess', 'handleControlRequest failed', { error: err?.message ?? String(err) }, '💥');
							});
							continue;
						}

						if (jsonData.type === 'control_response') {
							handleControlResponse(jsonData);
							continue;
						}

						// NOTE: do NOT stdin.end() on result. Ending stdin is what
						// makes the child exit; under reuse it must stay open for the
						// life of the session. Turn end is signalled by the `result`
						// event itself (see onTurnEnd in processJsonStreamData).
						processJsonStreamData(jsonData);
					} catch (error: any) {
						log.error('Subprocess', 'failed to parse JSON line', { line, error: error?.message ?? String(error) }, '💥');
					}
				}
			}
		});
	}

	if (proc.stderr) {
		proc.stderr.on('data', (data) => {
			const chunk = data.toString();
			errorOutput += chunk;
			if (!authErrorFired && AUTH_PATTERNS.some(p => p.test(chunk))) {
				fireAuthError(chunk);
			}
		});
	}

	proc.on('close', (code) => {
		// Identity guard: ignore the close of any process that is no longer the
		// live one (a reaped orphan from a respawn/kill).
		if (currentClaudeProcess !== proc) {
			log.debug('ClaudeProcess', 'ignoring close of stale process', { pid: proc.pid, code }, '👻');
			return;
		}

		disarmStallWatchdog();
		rejectAllPendingControl('process closed');
		sessionLock.release();
		// Drop deferred actions tied to this dead process so they don't fire on a
		// future warm process (review bug #5).
		pendingSettingsRestart = false;
		pendingModelSwitch = undefined;
		// Drop any in-flight silent query (e.g. title generation) so a dead
		// process can't leave awaitingSilentResult stuck and wrongly guard the
		// next warm process's first real turn.
		silentQueryCallback = null;
		pendingSilentQuery = null;
		awaitingSilentResult = false;

		if (authErrorFired) {
			currentClaudeProcess = undefined;
			spawnedPlanMode = undefined;
			queuedTurns = [];
			emitQueueState();
			permissions.cancelPendingPermissionRequests();
			deps!.postMessage({ type: 'clearLoading' });
			isProcessing = false;
			deps!.postMessage({ type: 'setProcessing', data: { isProcessing: false } });
			return;
		}

		currentClaudeProcess = undefined;
		spawnedPlanMode = undefined;
		queuedTurns = [];
		emitQueueState();

		permissions.cancelPendingPermissionRequests();

		deps!.postMessage({
			type: 'clearLoading'
		});

		isProcessing = false;

		deps!.postMessage({
			type: 'setProcessing',
			data: { isProcessing: false }
		});

		if (code !== 0 && errorOutput.trim()) {
			if (errorOutput.includes('not recognized as an internal or external command')) {
				deps!.postMessage({
					type: 'showInstallModal',
					installAttempted: !!deps!.getGlobalState().get('installAttempted')
				});
			} else {
				conversation.sendAndSaveMessage({
					type: 'error',
					data: errorOutput.trim()
				});
			}
		}
	});

	proc.on('error', (error) => {
		// Deliberate respawn (plan-mode toggle, thinking-pref change): the abort
		// killProcess() raises is expected, not a failure. Swallow it before any
		// state teardown so the user never sees the red card AND the live spawn
		// already in flight isn't disturbed (its identity is the new process).
		if (respawnInProgress && isAbortError(error)) {
			log.debug('Subprocess', 'expected abort during respawn — suppressing', { error: error.message }, '🤫');
			return;
		}

		log.error('Subprocess', 'claude process error', { error: error.message }, '💥');

		// Identity guard: ignore errors from a process that is no longer live.
		if (currentClaudeProcess !== proc) {
			return;
		}

		disarmStallWatchdog();
		rejectAllPendingControl('process error');
		sessionLock.release();
		pendingSettingsRestart = false;
		pendingModelSwitch = undefined;
		silentQueryCallback = null;
		pendingSilentQuery = null;
		awaitingSilentResult = false;

		currentClaudeProcess = undefined;
		spawnedPlanMode = undefined;
		queuedTurns = [];
		emitQueueState();

		permissions.cancelPendingPermissionRequests();

		deps!.postMessage({
			type: 'clearLoading'
		});

		isProcessing = false;

		deps!.postMessage({
			type: 'setProcessing',
			data: { isProcessing: false }
		});

		if (error.message.includes('ENOENT') || error.message.includes('command not found') || error.message.includes('not recognized as an internal or external command')) {
			deps!.postMessage({
				type: 'showInstallModal',
				installAttempted: !!deps!.getGlobalState().get('installAttempted')
			});
		} else if (userRequestedStop) {
			userRequestedStop = false;
		} else if (userPausedSession && isAbortError(error)) {
			// The user deliberately paused this session (+ / History). The abort is
			// expected — show a friendly yellow notice instead of the red error card.
			const reason = userPausedSession.reason;
			userPausedSession = null;
			conversation.sendAndSaveMessage({
				type: 'notice',
				data: {
					title: 'Session paused',
					content: reason === 'history'
						? 'Session paused — switched conversations.'
						: 'Session paused — started a new session.',
					variant: 'warning'
				}
			});
		} else {
			conversation.sendAndSaveMessage({
				type: 'error',
				data: `Error running Claude: ${error.message}`
			});
		}
	});

	// Initialize handshake — fire-and-forget so the turn loop is never blocked on
	// it. Populates the dynamic model/command list for the UI. Degrades silently
	// if the CLI rejects or times out (the turn still works without it).
	void performInitialize(proc);

	return true;
}

// Perform the `initialize` control_request handshake (Phase 0 schema) against a
// freshly spawned process. Caches and posts the dynamic models/commands list.
// `proc` is the process this handshake belongs to — we drop the result if it's
// no longer the live process by the time the response arrives (a respawn raced).
async function performInitialize(proc: cp.ChildProcess): Promise<void> {
	try {
		const resp = await sendControlRequest('initialize', { hooks: {}, sdkMcpServers: [] });
		if (currentClaudeProcess !== proc) {
			log.debug('Subprocess', 'initialize response for stale process — dropping', undefined, '👻');
			return;
		}
		cachedModels = Array.isArray(resp?.models) ? resp.models : undefined;
		cachedCommands = Array.isArray(resp?.commands) ? resp.commands : undefined;
		log.info('Subprocess', 'initialize handshake ok', {
			models: cachedModels?.length ?? 0,
			commands: cachedCommands?.length ?? 0,
		}, '🤝');
		postModelList();
		// Populate the context-usage chip before the first turn (handshake-time
		// occupancy: system prompt + memory + skills). Fire-and-forget.
		void postContextUsage();
	} catch (e: any) {
		// Non-fatal: the editable model field + legacy settings path still work.
		log.warn('Subprocess', 'initialize handshake failed (degrading)', { error: e?.message ?? String(e) }, '⚠️');
	}
}

// Post the cached model list to the webview (used after initialize and on a
// late getModelList request from the UI).
export function postModelList(): void {
	if (!deps) { return; }
	deps.postMessage({
		type: 'modelList',
		data: {
			models: cachedModels ?? [],
			selected: settings.getSelectedModel(),
		},
	});
}

export function getCachedModels(): any[] | undefined {
	return cachedModels;
}

// ── Context-window usage ──────────────────────────────────────────────────
// `get_context_usage` is the SAME control request /context uses: it returns the
// authoritative occupancy ({ totalTokens, maxTokens, percentage (already
// computed), autoCompactThreshold, isAutoCompactEnabled, categories[] }) for the
// live model. It is a control round-trip (no model turn → effectively free), so
// we poll it at turn boundaries. Degrades silently on older binaries / errors.
async function getContextUsage(): Promise<any | null> {
	if (!currentClaudeProcess) { return null; }
	try {
		return await sendControlRequest('get_context_usage');
	} catch (e: any) {
		log.debug('Subprocess', 'get_context_usage failed (degrading)', { error: e?.message ?? String(e) }, '📐');
		return null;
	}
}

// Fetch context usage and post a compact slice to the webview. No-op (chip stays
// hidden) if the call failed or returned no usable percentage.
async function postContextUsage(): Promise<void> {
	if (!deps) { return; }
	const u = await getContextUsage();
	if (!u || typeof u.percentage !== 'number') { return; }
	deps.postMessage({
		type: 'contextUsage',
		data: {
			totalTokens: u.totalTokens ?? 0,
			maxTokens: u.maxTokens ?? 0,
			percentage: u.percentage ?? 0,
			autoCompactThreshold: u.autoCompactThreshold ?? 0,
			isAutoCompactEnabled: !!u.isAutoCompactEnabled,
			// {name, tokens} pairs for the hover tooltip; drop the color/grid fields.
			categories: Array.isArray(u.categories)
				? u.categories.map((c: any) => ({ name: c.name, tokens: c.tokens }))
				: [],
		},
	});
}

// A model switch requested mid-turn, deferred to the next idle boundary so we
// never interleave a set_model control_request into an active turn's stream.
let pendingModelSwitch: string | undefined;

// Switch the live process's model in-band via the set_model control_request
// (Phase 0 confirmed Bedrock + [1m] ids are accepted). On success, persist the
// choice for the status bar / next spawn. On rejection, keep the prior model and
// surface the error. Gated on idle: if a turn is in flight we DEFER to the next
// turn-end (the switch applies to the NEXT turn), not interleave mid-stream.
export async function setModel(model: string): Promise<void> {
	if (!deps) { return; }
	if (!currentClaudeProcess) {
		// No live process yet — just record the choice; it applies on next spawn.
		settings.recordSelectedModel(model);
		deps.postMessage({ type: 'modelSet', data: { model, ok: true } });
		log.info('Subprocess', 'setModel recorded (no live process)', { model }, '📝');
		return;
	}
	if (isProcessing) {
		// Defer to the next idle boundary (applied in onTurnEnd). Tell the UI so
		// the picker can show a "applies next turn" marker instead of silently
		// doing nothing.
		pendingModelSwitch = model;
		deps.postMessage({ type: 'modelSet', data: { model, ok: true, deferred: true } });
		log.info('Subprocess', 'setModel deferred (turn in flight)', { model }, '⏸️');
		return;
	}
	try {
		await sendControlRequest('set_model', { model });
		settings.recordSelectedModel(model);
		deps.postMessage({ type: 'modelSet', data: { model, ok: true } });
		log.info('Subprocess', 'set_model ok', { model }, '🔀');
	} catch (e: any) {
		const error = e?.message ?? String(e);
		log.warn('Subprocess', 'set_model rejected — keeping prior model', { model, error }, '⚠️');
		deps.postMessage({ type: 'modelSet', data: { model, ok: false, error } });
	}
}

// Build the user-message JSON (inline + attached images) and write it to the
// warm process's stdin. The process stays open for reuse on the next turn.
async function writeUserTurn(actualMessage: string, images?: Array<string | { filePath: string; previewUri?: string }>): Promise<boolean> {
	const stdin = currentClaudeProcess?.stdin;
	if (!stdin) {
		log.error('Subprocess', 'writeUserTurn — no live stdin', undefined, '💥');
		return false;
	}

	const content: Array<{type: string; text?: string; source?: {type: string; media_type: string; data: string}}> = [];

	const imagePathRegex = /(\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|bmp))\b/gi;
	let lastIndex = 0;
	let match;
	while ((match = imagePathRegex.exec(actualMessage)) !== null) {
		const imagePath = match[1];
		const ext = path.extname(imagePath).toLowerCase();
		if (IMAGE_EXTENSIONS.includes(ext)) {
			try {
				const imageData = await vscode.workspace.fs.readFile(vscode.Uri.file(imagePath));
				const base64 = Buffer.from(imageData).toString('base64');
				const textBefore = actualMessage.substring(lastIndex, match.index);
				if (textBefore.trim()) {
					content.push({ type: 'text', text: textBefore.trim() });
				}
				content.push({
					type: 'image',
					source: {
						type: 'base64',
						media_type: IMAGE_MEDIA_TYPES[ext] || 'image/png',
						data: base64
					}
				});
				lastIndex = match.index + match[0].length;
			} catch (e: any) {
				log.error('Subprocess', 'could not read inline image', { imagePath, error: e?.message ?? String(e) }, '💥');
			}
		}
	}
	const remaining = actualMessage.substring(lastIndex);
	if (remaining.trim()) {
		content.push({ type: 'text', text: remaining.trim() });
	}

	if (images && images.length > 0) {
		for (const img of images) {
			const imagePath = typeof img === 'string' ? img : img.filePath;
			if (!imagePath) { continue; }
			const ext = IMAGE_EXTENSIONS.find(e => imagePath.toLowerCase().endsWith(e));
			if (ext) {
				try {
					const imageData = await vscode.workspace.fs.readFile(vscode.Uri.file(imagePath));
					const base64 = Buffer.from(imageData).toString('base64');
					content.push({
						type: 'image',
						source: {
							type: 'base64',
							media_type: IMAGE_MEDIA_TYPES[ext] || 'image/png',
							data: base64
						}
					});
				} catch (e: any) {
					log.error('Subprocess', 'could not read attached image', { imagePath, error: e?.message ?? String(e) }, '💥');
				}
			}
		}
	}

	if (content.length === 0) {
		content.push({ type: 'text', text: actualMessage });
	}

	const userMessage = {
		type: 'user',
		session_id: conversation.getCurrentSessionId() || '',
		message: {
			role: 'user',
			content: content
		},
		parent_tool_use_id: null
	};
	stdin.write(JSON.stringify(userMessage) + '\n');
	return true;
}

// ── Stall watchdog (armed per turn, lives across the warm process) ─────────
// Arms when a turn is sent; disarms on result/abort. It never runs between
// turns, so a warm-but-idle process is never SIGTERM'd for "inactivity".
function armStallWatchdog(): void {
	disarmStallWatchdog();
	lastStdoutMs = Date.now();
	stallNotified = false;
	stallKilled = false;
	stallTimer = setInterval(() => {
		// NOTE: per-turn auto-continue state (autoContinueCount, toolInFlight,
		// lastResultWasError) is reset at turn start in runTurn() and on a real
		// result in onTurnEnd() — NOT here, because armStallWatchdog is also called
		// by injectContinue() to give a resumed turn a fresh silence window, and
		// resetting the count there would defeat the cap.
		if (!deps || !currentClaudeProcess || authErrorFired || stallKilled) {
			disarmStallWatchdog();
			return;
		}
		if (permissions.hasPending()) {
			lastStdoutMs = Date.now();
			if (stallNotified) {
				stallNotified = false;
				deps.postMessage({ type: 'stallHintClear' });
			}
			return;
		}
		const silentFor = Date.now() - lastStdoutMs;
		if (!stallNotified && silentFor > STALL_NOTIFY_MS) {
			stallNotified = true;
			log.warn('StallWatchdog', 'stall notified', { silentFor }, '⏳');
			deps.postMessage({
				type: 'processStalled',
				data: { sinceLastMs: silentFor }
			});
		}
		// Auto-continue stage (60s): the turn went quiet mid-stream without a
		// terminal `result`. Inject ONE invisible "continue" nudge to recover a
		// dropped turn — but only when it's safe to: feature enabled, a turn is
		// actually in flight, not waiting on a tool, the last result wasn't a real
		// error, the user didn't just Stop, and we haven't already used the cap.
		if (
			silentFor > STALL_AUTOCONTINUE_MS &&
			autoContinueEnabled() &&
			isProcessing &&
			!toolInFlight &&
			!lastResultWasError &&
			!userRequestedStop &&
			autoContinueCount < AUTO_CONTINUE_MAX
		) {
			autoContinueCount++;
			log.warn('StallWatchdog', 'auto-continue firing', { silentFor, attempt: autoContinueCount }, '↩️');
			injectContinue();   // writes the nudge to stdin + re-arms (fresh window)
			return;
		}
		// Escalation: we already spent the auto-continue cap and the turn STILL went
		// quiet past the auto-continue window — surface a visible card once so the
		// user isn't left silently stuck (the 120s kill remains the final backstop).
		if (
			silentFor > STALL_AUTOCONTINUE_MS &&
			autoContinueCount >= AUTO_CONTINUE_MAX &&
			!autoContinueEscalated &&
			autoContinueEnabled() &&
			!toolInFlight &&
			!lastResultWasError
		) {
			autoContinueEscalated = true;
			log.warn('StallWatchdog', 'auto-continue cap exhausted — escalating', { silentFor }, '⚠️');
			conversation.sendAndSaveMessage({
				type: 'notice',
				data: {
					title: 'Turn stalled',
					content: 'The turn went quiet and an automatic nudge didn\'t recover it. The session is still active — send a message to continue, or Stop to reset.',
					variant: 'warning'
				}
			});
		}
		if (silentFor > STALL_KILL_MS) {
			stallKilled = true;
			const proc = currentClaudeProcess;
			log.error('StallWatchdog', 'stall killed', { silentFor, pid: proc?.pid }, '☠️');
			deps.postMessage({
				type: 'processKilled',
				data: { reason: 'inactivity', silentMs: silentFor }
			});
			try { proc?.kill('SIGTERM'); } catch { /* already dead */ }
			setTimeout(() => {
				try { proc?.kill('SIGKILL'); } catch { /* already dead */ }
			}, 2_000);
			disarmStallWatchdog();
		}
	}, 5_000);
}

function disarmStallWatchdog(): void {
	if (stallTimer) { clearInterval(stallTimer); stallTimer = undefined; }
	stallNotified = false;
}

// Called when a turn completes (the `result` event). Flips processing off,
// disarms the watchdog, flushes a pending silent query, then drains one queued
// user turn (if any) against the still-warm process.
function onTurnEnd(): void {
	if (!deps) { return; }

	// Guard: a silent-query completion (e.g. title generation) must NOT run the
	// drain/deferral logic below — otherwise it would prematurely flush a queued
	// user turn or apply a deferred set_model/settings restart. The flag is
	// cleared HERE, on the result event (the silentQueryCallback already fired
	// earlier, on the assistant text block), then we return without touching the
	// queue or deferred switches. isProcessing was never set by sendSilentQuery,
	// so there is no processing state to reconcile here.
	if (awaitingSilentResult) {
		awaitingSilentResult = false;
		log.debug('Subprocess', 'onTurnEnd: silent-query result — guarded, skipping drain/deferral', undefined, '🤫');
		return;
	}

	// A turn completed normally, so any pending pause flag is stale (the abort
	// path didn't claim it). Clear it so it can't downgrade a genuine abort later.
	userPausedSession = null;

	isProcessing = false;
	disarmStallWatchdog();
	// If an auto-continue nudge was used this turn and we still reached a real
	// result, the recovery worked — log it (greppable alongside the firing line).
	if (autoContinueCount > 0) {
		log.info('Subprocess', 'auto-continue recovered turn', { attempts: autoContinueCount }, '✅');
	}
	// Turn genuinely ended → clear the per-turn auto-continue state so the next
	// turn starts clean (also covered by runTurn, but this catches turns that end
	// without a fresh runTurn, e.g. the last in a drained queue).
	autoContinueCount = 0;
	autoContinueEscalated = false;
	toolInFlight = false;
	deps.postMessage({ type: 'setProcessing', data: { isProcessing: false } });
	flushPendingSilentQuery();

	// Title generation (contract step 3): issue the 3-then-6 title query at this
	// idle boundary. It goes out as a silent query whose own `result` is caught
	// by the guard above, so it never drains the queue or applies a deferred
	// switch.
	maybeGenerateTitle();

	// A model switch requested mid-turn applies now (before the next turn). Do
	// this before a settings restart: if both are pending, the restart respawns
	// and the recorded model is picked up anyway.
	if (pendingModelSwitch) {
		const m = pendingModelSwitch;
		pendingModelSwitch = undefined;
		void setModel(m);
	}

	// A settings/profile change arrived mid-turn — apply the deferred restart now
	// that we're at an idle boundary, before draining any queued turn (so the
	// queued turn runs under the new provider env).
	if (pendingSettingsRestart) {
		pendingSettingsRestart = false;
		void applySettingsRestart();
	}

	// Drain one queued turn (FIFO). This is the ONLY path that pulls from
	// queuedTurns, so a Send-now interrupt (which leaves the queue intact and
	// relies on this drain) can never double-execute the head.
	if (queuedTurns.length > 0) {
		const next = queuedTurns.shift()!;
		log.info('ClaudeProcess', 'flushing queued turn', { remaining: queuedTurns.length }, '▶️');
		emitQueueState();
		void runTurn(next);
	}
}

// ── Session title generation (3-then-6 schedule) ───────────────────────────
// Issue a title silent-query at an idle turn boundary. Forward-only:
//   • turns 3–5: provisional title, fired once (gated on "no title yet", which
//     also survives reload since the restored title suppresses a re-fire);
//   • turns >= 6: final title, then conversation.isTitleLocked() blocks any
//     further regeneration forever.
// Uses sendSilentQuery, so its result is caught by onTurnEnd's guard and never
// drains the queue. An empty/garbage answer keeps the existing title.
function maybeGenerateTitle(): void {
	// A locked (final) title never regenerates.
	if (conversation.isTitleLocked()) { return; }

	const userTurns = conversation.getUserTurnCount();
	if (userTurns < 3) { return; }

	const isFinal = userTurns >= 6;

	// Below turn 6, only generate a provisional if there isn't one yet — so it
	// fires once across turns 3–5 (and not again after a resume that restored a
	// provisional title). A failed/empty provisional leaves the title unset, so
	// it will retry on the next boundary, which is fine.
	if (!isFinal && conversation.getCurrentTitle()) { return; }

	// Don't issue a second silent query while one is already outstanding (single
	// callback slot). It gets another chance at the next turn boundary.
	if (silentQueryCallback !== null) { return; }

	log.info('Subprocess', 'maybeGenerateTitle', { userTurns, isFinal }, '🏷️');
	sendSilentQuery(TITLE_PROMPT, (answer) => {
		const title = sanitizeTitle(answer);
		if (!title) {
			log.debug('Subprocess', 'title answer empty/unusable — keeping existing', { answer }, '🏷️');
			return;
		}
		conversation.setSessionTitle(title, isFinal);
	});
}

// ── Settings/profile restart ──────────────────────────────────────────────
// The provider/account/region come from settings.json's env block, read at
// process startup — so a profile swap needs a process restart (model-within-
// provider is the in-band set_model path instead). We kill the warm process at
// an idle boundary; the next sendMessage lazily respawns with --resume, which
// re-reads the new env and re-runs the initialize handshake.
let pendingSettingsRestart = false;

export function requestSettingsRestart(): void {
	if (!currentClaudeProcess) {
		// No warm process — nothing to restart; the next spawn picks up new env.
		log.debug('Subprocess', 'settings restart requested (no live process — noop)', undefined, '⚙️');
		return;
	}
	if (isProcessing) {
		// Defer to the next idle boundary so we don't interrupt an active turn.
		log.info('Subprocess', 'settings restart deferred (turn in flight)', undefined, '⚙️');
		pendingSettingsRestart = true;
		return;
	}
	void applySettingsRestart();
}

async function applySettingsRestart(): Promise<void> {
	log.info('Subprocess', 'applying settings restart (graceful kill — respawn on next turn)', undefined, '♻️');
	await killProcess();
	// Note: do NOT clear the session id — the next sendMessage respawns with
	// --resume <id> under the new provider env and re-runs initialize.
}

async function processJsonStreamData(jsonData: any): Promise<void> {
	if (!deps) { return; }

	// Log only at meaningful transitions — skip the per-token content_block_delta
	// and the paired system/thinking_tokens since they fire dozens of times per
	// turn and add no actionable info. Anything genuinely useful (init, status,
	// content_block_start/stop, message_start/stop, result, errors) still logs.
	const evType = jsonData?.type;
	const evSub = jsonData?.subtype || jsonData?.event?.type;
	const isHighVolume =
		(evType === 'stream_event' && evSub === 'content_block_delta') ||
		(evType === 'system' && evSub === 'thinking_tokens');
	if (!isHighVolume) {
		log.debug('StreamParser', 'streamData', { type: evType, subtype: evSub }, '📡');
	}

	switch (jsonData.type) {
		case 'stream_event': {
			const ev = jsonData.event;
			if (!ev) { break; }
			if (ev.type === 'content_block_start' && ev.content_block) {
				const blockType = ev.content_block.type;
				log.debug('StreamParser', 'content_block_start', { blockType, index: ev.index }, '🧱');
				if (blockType === 'thinking') {
					log.info('StreamParser', 'thinkingBlockStart sent', undefined, '🧠');
					deps.postMessage({ type: 'thinkingBlockStart' });
				}
			} else if (ev.type === 'content_block_delta' && ev.delta) {
				const deltaType = ev.delta.type;
				if (deltaType === 'thinking_delta') {
					const chunk = ev.delta.thinking;
					if (typeof chunk === 'string' && chunk.length > 0) {
						log.debug('StreamParser', 'thinkingDelta sent', { chunkLen: chunk.length, chunkSnippet: chunk }, '🧠');
						deps.postMessage({ type: 'thinkingDelta', data: chunk });
					} else {
						log.warn('StreamParser', 'thinking_delta has empty chunk', { deltaKeys: Object.keys(ev.delta) }, '🤔');
					}
				} else if (deltaType && deltaType !== 'text_delta' && deltaType !== 'input_json_delta') {
					// Unknown delta types — surface so we notice if Anthropic adds a new one
					log.warn('StreamParser', 'unknown content_block_delta type', { deltaType, deltaKeys: Object.keys(ev.delta) }, '🤔');
				}
			}
			break;
		}

		case 'system':
			if (jsonData.subtype === 'init') {
				const prevSessionId = conversation.getCurrentSessionId();
				conversation.setCurrentSessionId(jsonData.session_id);
				// Promote any images attached before an id existed (pending_*) to the
				// freshly-minted id; and if this init reports a rotation on a warm
				// process (prev id present and different), re-prefix that session's
				// images. Forks never reach here for THIS window's id (out-of-process).
				renamePendingImages(jsonData.session_id);
				if (prevSessionId && prevSessionId !== jsonData.session_id) {
					renameSessionImages(prevSessionId, jsonData.session_id);
				}
				// Acquire/rebind the cross-window lock to the id the CLI reports
				// (covers brand-new sessions whose id is minted here, and any id
				// rotation on a warm process).
				sessionLock.rebind(jsonData.session_id);

				conversation.sendAndSaveMessage({
					type: 'sessionInfo',
					data: {
						sessionId: jsonData.session_id,
						tools: jsonData.tools || [],
						mcpServers: jsonData.mcp_servers || []
					}
				});
			} else if (jsonData.subtype === 'status') {
				if (jsonData.status === 'compacting') {
					conversation.sendAndSaveMessage({
						type: 'compacting',
						data: { isCompacting: true }
					});
				} else if (jsonData.status === null) {
					conversation.sendAndSaveMessage({
						type: 'compacting',
						data: { isCompacting: false }
					});
				}
			} else if (jsonData.subtype === 'compact_boundary') {
				const { totalCost } = tokenCounters.getTotals();
				tokenCounters.setTotals(totalCost, 0, 0);

				conversation.sendAndSaveMessage({
					type: 'compactBoundary',
					data: {
						trigger: jsonData.compact_metadata?.trigger,
						preTokens: jsonData.compact_metadata?.pre_tokens
					}
				});
			}
			break;

		case 'assistant':
			if (jsonData.message && jsonData.message.content) {
				if (jsonData.message.usage) {
					tokenCounters.addTokens(
						jsonData.message.usage.input_tokens || 0,
						jsonData.message.usage.output_tokens || 0
					);
					const totals = tokenCounters.getTotals();

					conversation.sendAndSaveMessage({
						type: 'updateTokens',
						data: {
							totalTokensInput: totals.totalTokensInput,
							totalTokensOutput: totals.totalTokensOutput,
							currentInputTokens: jsonData.message.usage.input_tokens || 0,
							currentOutputTokens: jsonData.message.usage.output_tokens || 0,
							cacheCreationTokens: jsonData.message.usage.cache_creation_input_tokens || 0,
							cacheReadTokens: jsonData.message.usage.cache_read_input_tokens || 0
						}
					});
				}

				for (const content of jsonData.message.content) {
					if (content.type === 'text' && content.text.trim()) {
						if (silentQueryCallback) {
							silentQueryCallback(content.text.trim());
							silentQueryCallback = null;
							continue;
						}
						conversation.sendAndSaveMessage({
							type: 'output',
							data: content.text.trim()
						});
					} else if (content.type === 'thinking' && content.thinking.trim()) {
						conversation.sendAndSaveMessage({
							type: 'thinking',
							data: content.thinking.trim()
						});
					} else if (content.type === 'tool_use') {
						// A tool is now running; the claude stream legitimately goes quiet
						// until its tool_result returns. Suppress the 60s auto-continue while
						// this is true (see armStallWatchdog) — the turn isn't dropped, the
						// tool is just working.
						toolInFlight = true;
						const toolInfo = `🔧 Executing: ${content.name}`;
						let toolInput = '';
						let fileContentBefore: string | undefined;

						if (content.input) {
							if (content.name === 'TodoWrite' && content.input.todos) {
								toolInput = '\nTodo List Update:';
								for (const todo of content.input.todos) {
									const status = todo.status === 'completed' ? '✅' :
										todo.status === 'in_progress' ? '🔄' : '⏳';
									toolInput += `\n${status} ${todo.content} (priority: ${todo.priority})`;
								}
							} else {
								toolInput = '';
							}

							if ((content.name === 'Edit' || content.name === 'MultiEdit' || content.name === 'Write') && content.input.file_path) {
								try {
									const fileUri = vscode.Uri.file(content.input.file_path);
									const fileData = await vscode.workspace.fs.readFile(fileUri);
									fileContentBefore = Buffer.from(fileData).toString('utf8');
								} catch {
									fileContentBefore = '';
								}
							}
						}

						let startLine: number | undefined;
						let startLines: number[] | undefined;
						if (fileContentBefore !== undefined) {
							if (content.name === 'Edit' && content.input.old_string) {
								const position = fileContentBefore.indexOf(content.input.old_string);
								if (position !== -1) {
									const textBefore = fileContentBefore.substring(0, position);
									startLine = (textBefore.match(/\n/g) || []).length + 1;
								} else {
									startLine = 1;
								}
							} else if (content.name === 'MultiEdit' && content.input.edits) {
								startLines = content.input.edits.map((edit: any) => {
									if (edit.old_string) {
										const position = fileContentBefore!.indexOf(edit.old_string);
										if (position !== -1) {
											const textBefore = fileContentBefore!.substring(0, position);
											return (textBefore.match(/\n/g) || []).length + 1;
										}
									}
									return 1;
								});
							}
						}

						conversation.sendAndSaveMessage({
							type: 'toolUse',
							data: {
								toolInfo: toolInfo,
								toolInput: toolInput,
								rawInput: content.input,
								toolName: content.name,
								fileContentBefore: fileContentBefore,
								startLine: startLine,
								startLines: startLines
							}
						});
					}
				}
			}
			break;

		case 'user':
			if (jsonData.message && jsonData.message.content) {
				for (const content of jsonData.message.content) {
					if (content.type === 'tool_result') {
						// Tool finished — the stream may now legitimately go quiet while
						// the model thinks about the result. Clear the in-flight flag so a
						// genuinely dropped turn after this point can be auto-continued.
						toolInFlight = false;
						let resultContent = content.content || 'Tool executed successfully';

						if (typeof resultContent === 'object' && resultContent !== null) {
							resultContent = JSON.stringify(resultContent, null, 2);
						}

						const isError = content.is_error || false;

						const lastToolUse = conversation.getCurrentConversation()[conversation.getCurrentConversation().length - 1]

						const toolName = lastToolUse?.data?.toolName;
						const rawInput = lastToolUse?.data?.rawInput;
						const startLine = lastToolUse?.data?.startLine;
						const startLines = lastToolUse?.data?.startLines;

						let fileContentAfter: string | undefined;
						if ((toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write') && rawInput?.file_path && !isError) {
							try {
								const fileUri = vscode.Uri.file(rawInput.file_path);
								const fileData = await vscode.workspace.fs.readFile(fileUri);
								fileContentAfter = Buffer.from(fileData).toString('utf8');
							} catch {
								// File read failed, that's ok
							}
						}

						if ((toolName === 'Read' || toolName === 'TodoWrite') && !isError) {
							conversation.sendAndSaveMessage({
								type: 'toolResult',
								data: {
									content: resultContent,
									isError: isError,
									toolUseId: content.tool_use_id,
									toolName: toolName,
									rawInput: rawInput,
									hidden: true
								}
							});
						} else {
							conversation.sendAndSaveMessage({
								type: 'toolResult',
								data: {
									content: resultContent,
									isError: isError,
									toolUseId: content.tool_use_id,
									toolName: toolName,
									rawInput: rawInput,
									fileContentAfter: fileContentAfter,
									startLine: startLine,
									startLines: startLines
								}
							});
						}
					}
				}
			}
			break;

		case 'result':
			// Record whether this turn ended on a genuine error so the auto-continue
			// watchdog won't try to "recover" a known-bad end (which would just loop
			// the same failure). A non-'success' subtype (e.g. error_during_execution)
			// or an is_error success both count as error ends.
			lastResultWasError = jsonData.subtype !== 'success' || !!jsonData.is_error;
			if (jsonData.subtype === 'success') {
				if (jsonData.is_error && jsonData.result && (
					jsonData.result.includes('Invalid API key') ||
					jsonData.result.includes('Not logged in') ||
					jsonData.result.includes('/login') ||
					jsonData.result.includes('not authenticated')
				)) {
					handleLoginRequired();
					return;
				}

				if (jsonData.session_id) {
					// Adopt the latest reported session_id (authoritative for any
					// later --resume / --fork-session). The process is NOT respawned
					// per turn, so this keeps the stored id current if it ever rotates.
					const prevSessionId = conversation.getCurrentSessionId();
					conversation.setCurrentSessionId(jsonData.session_id);
					// In-window id rotation: re-prefix this session's images so
					// delete-by-prefix and the sweep stay accurate. A fork is
					// out-of-process and never mutates this window's id, so it never
					// triggers a rename here.
					if (prevSessionId && prevSessionId !== jsonData.session_id) {
						renameSessionImages(prevSessionId, jsonData.session_id);
					}

					conversation.sendAndSaveMessage({
						type: 'sessionInfo',
						data: {
							sessionId: jsonData.session_id,
							tools: jsonData.tools || [],
							mcpServers: jsonData.mcp_servers || []
						}
					});
				}

				tokenCounters.addRequest();
				// `total_cost_usd` is CUMULATIVE per warm process, so bill only the
				// delta since the previous result on this process — adding the raw
				// cumulative every turn compounds the total quadratically. Reset the
				// baseline on spawn (see spawnProcess). max(0, …) keeps any duplicate
				// or out-of-order result from subtracting (fails safe: under, not over).
				let turnCostDelta = 0;
				if (typeof jsonData.total_cost_usd === 'number') {
					const cumulative = jsonData.total_cost_usd;
					turnCostDelta = Math.max(0, cumulative - lastProcessCumulativeCost);
					lastProcessCumulativeCost = cumulative;
					if (turnCostDelta > 0) {
						tokenCounters.addTokens(0, 0, turnCostDelta);
					}
				}

				try {
					const globalState = deps.getGlobalState();
					const prev = globalState.get<number>('lifetimeMessageSuccessCount', 0) || 0;
					const next = prev + 1;
					globalState.update('lifetimeMessageSuccessCount', next);
					if (next === 1 || next === 50 || (next > 50 && next % 100 === 0)) {
						deps.postMessage({ type: 'messageMilestone', count: next });
					}
				} catch {
					// best-effort
				}

				const resultTotals = tokenCounters.getTotals();
				deps.postMessage({
					type: 'updateTotals',
					data: {
						totalCost: resultTotals.totalCost,
						totalTokensInput: resultTotals.totalTokensInput,
						totalTokensOutput: resultTotals.totalTokensOutput,
						requestCount: resultTotals.requestCount,
						currentCost: turnCostDelta,
						currentDuration: jsonData.duration_ms,
						currentTurns: jsonData.num_turns
					}
				});

				// Refresh the context-window chip now that the turn changed occupancy.
				// Control round-trip, no model turn — effectively free. Fire-and-forget.
				void postContextUsage();
			}

			// Turn complete (any result subtype). Flip processing off, disarm
			// the watchdog, flush a pending silent query, and drain one queued
			// turn against the still-warm process. The process is NOT closed.
			onTurnEnd();
			break;
	}
}

function handleLoginRequired(): void {
	log.warn('Subprocess', 'handleLoginRequired', undefined, '🔐');
	if (!deps) { return; }

	// Login failure ends the turn; clear any queued turns since they would also
	// fail, and disarm the watchdog.
	queuedTurns = [];
	emitQueueState();
	disarmStallWatchdog();
	isProcessing = false;

	deps.postMessage({
		type: 'setProcessing',
		data: { isProcessing: false }
	});

	terminalCommands.openLoginTerminal();
	deps.postMessage({
		type: 'loginRequired'
	});
}

async function killProcessGroup(pid: number, signal: string = 'SIGTERM'): Promise<void> {
	log.debug('Subprocess', 'enter killProcessGroup', { pid, signal, isWslProcess }, '➡️');
	if (isWslProcess) {
		try {
			const killSignal = signal === 'SIGKILL' ? '-9' : '-15';
			await exec(`wsl -d ${wslDistro} pkill ${killSignal} -f "claude"`);
		} catch {
			// Process may already be dead or pkill not available
		}
		try {
			await exec(`taskkill /pid ${pid} /t /f`);
		} catch {
			// Process may already be dead
		}
	} else if (process.platform === 'win32') {
		try {
			await exec(`taskkill /pid ${pid} /t /f`);
		} catch {
			// Process may already be dead
		}
	} else {
		try {
			process.kill(-pid, signal as NodeJS.Signals);
		} catch {
			// Process may already be dead
		}
	}
}

export async function killProcess(): Promise<void> {
	const processToKill = currentClaudeProcess;
	const pid = processToKill?.pid;
	log.info('ClaudeProcess', 'killClaudeProcess', { pid }, '💀');

	abortController?.abort();
	abortController = undefined;

	// Tear down all reuse state so the next sendMessage spawns cleanly. The
	// close handler is identity-guarded and will no-op for this (now-stale) proc.
	currentClaudeProcess = undefined;
	spawnedPlanMode = undefined;
	queuedTurns = [];
	cachedModels = undefined;
	cachedCommands = undefined;
	pendingModelSwitch = undefined;
	disarmStallWatchdog();
	rejectAllPendingControl('process killed');
	sessionLock.release();

	if (!pid) {
		return;
	}

	await killProcessGroup(pid, 'SIGTERM');

	const exitPromise = new Promise<void>((resolve) => {
		if (processToKill?.killed) {
			resolve();
			return;
		}
		processToKill?.once('exit', () => resolve());
	});

	const timeoutPromise = new Promise<void>((resolve) => {
		setTimeout(() => resolve(), 2000);
	});

	await Promise.race([exitPromise, timeoutPromise]);

	if (processToKill && !processToKill.killed) {
		await killProcessGroup(pid, 'SIGKILL');
	}
}

// STOP (graceful): interrupt the in-flight turn but keep the process WARM so the
// next turn reuses the same pid. Verified: the CLI emits a `result`
// (error_during_execution) after the interrupt acks, which routes through
// onTurnEnd to flip isProcessing false and drain the queue. If the interrupt
// doesn't land (no live process, or it times out), escalate to Skull.
export async function stopProcess(): Promise<void> {
	log.info('Subprocess', 'enter stopProcess (interrupt)', undefined, '➡️');
	if (!deps) { return; }

	if (!currentClaudeProcess || !isProcessing) {
		// Nothing in flight — just normalize UI state.
		isProcessing = false;
		disarmStallWatchdog();
		deps.postMessage({ type: 'setProcessing', data: { isProcessing: false } });
		deps.postMessage({ type: 'clearLoading' });
		return;
	}

	// Clear any queued turns so the interrupt doesn't immediately get followed by
	// a queued send. (The user asked to stop.)
	queuedTurns = [];
	emitQueueState();

	try {
		await sendControlRequest('interrupt', {});
		log.info('Subprocess', 'interrupt acked — process kept warm', undefined, '🛑');
		// onTurnEnd (from the resulting `result`) will flip processing/clear loading.
		// Surface a notice; keep the process alive.
		conversation.sendAndSaveMessage({
			type: 'notice',
			data: { title: 'Stopped', content: 'Request interrupted by user.', variant: 'warning' }
		});
		// Fallback: the CLI normally emits a `result` (error_during_execution) after
		// the interrupt acks, which calls onTurnEnd. But if no result arrives,
		// isProcessing would stick true (Stop stuck, sends only queue). Force a
		// turn-end after a short grace period if we're still marked processing.
		const procAtInterrupt = currentClaudeProcess;
		setTimeout(() => {
			if (isProcessing && currentClaudeProcess === procAtInterrupt) {
				log.warn('Subprocess', 'no result after interrupt — forcing turn end', undefined, '⏱️');
				// Surface the anomaly — the CLI acked the interrupt but never emitted a
				// `result`, so the turn would otherwise vanish with no feedback. The
				// session is still warm; the user can just send again.
				conversation.sendAndSaveMessage({
					type: 'notice',
					data: {
						title: 'Turn ended without a result',
						content: 'Claude acknowledged the stop but never returned a result, so the turn was force-ended. The session is still active — send again to continue.',
						variant: 'warning'
					}
				});
				onTurnEnd();
			}
		}, 6_000);
	} catch (e: any) {
		// Interrupt didn't land — escalate to a hard kill (Skull behavior).
		log.warn('Subprocess', 'interrupt failed — escalating to hard kill', { error: e?.message ?? String(e) }, '⚠️');
		await skullProcess();
	}
}

// SEND NOW (explicit interrupt + flush head): the card's ⬆ control. Interrupt
// the in-flight turn via the warm interrupt (process stays alive) WITHOUT
// clearing the queue, so the resulting `result` → onTurnEnd drains the head as
// the next turn. Exactly-once by construction: onTurnEnd's drain is the ONLY
// path that pulls from queuedTurns, so the head can never run twice (the
// double-execution guard is "don't run it here — let the drain do it"). If the
// interrupt can't land we fall back to a natural turn boundary; if no `result`
// arrives we force onTurnEnd after a grace period so the head isn't stranded.
export async function sendNow(): Promise<void> {
	log.info('Subprocess', 'enter sendNow (interrupt + flush head)', { queueLen: queuedTurns.length }, '➡️');
	if (!deps) { return; }

	if (queuedTurns.length === 0) {
		log.debug('Subprocess', 'sendNow with empty queue — noop', undefined, '🤷');
		return;
	}

	if (!currentClaudeProcess || !isProcessing) {
		// No turn in flight — just drain the head immediately (no interrupt needed).
		const next = queuedTurns.shift()!;
		emitQueueState();
		void runTurn(next);
		return;
	}

	try {
		await sendControlRequest('interrupt', {});
		log.info('Subprocess', 'sendNow interrupt acked — head will flush via onTurnEnd', undefined, '⏭️');
		conversation.sendAndSaveMessage({
			type: 'notice',
			data: { title: 'Interrupted', content: 'Running the queued prompt now.', variant: 'warning' }
		});
		// Fallback: if the CLI doesn't emit a `result` after the interrupt acks,
		// isProcessing would stick true and the head would never drain. Force a
		// turn-end after a short grace period if we're still marked processing.
		const procAtInterrupt = currentClaudeProcess;
		setTimeout(() => {
			if (isProcessing && currentClaudeProcess === procAtInterrupt) {
				log.warn('Subprocess', 'no result after sendNow interrupt — forcing turn end', undefined, '⏱️');
				// Surface the anomaly — interrupt acked but no `result` arrived, so we
				// force the turn end to drain the queued head. Tell the user why there
				// was a gap; the queued prompt still runs next.
				conversation.sendAndSaveMessage({
					type: 'notice',
					data: {
						title: 'Turn ended without a result',
						content: 'Claude acknowledged the interrupt but never returned a result, so the turn was force-ended. Running your queued prompt now.',
						variant: 'warning'
					}
				});
				onTurnEnd();
			}
		}, 6_000);
	} catch (e: any) {
		// Interrupt didn't land — leave the item queued; it flushes at the next
		// natural turn boundary. Don't escalate to a kill (the user wants the
		// queued prompt to run, not the session destroyed).
		log.warn('Subprocess', 'sendNow interrupt failed — head stays queued for natural drain', { error: e?.message ?? String(e) }, '⚠️');
	}
}

// CANCEL a queued item by id (the card's ✕). Removes it from queuedTurns and
// re-emits so the peeking card updates to the next head or disappears.
export function cancelQueued(id: string): void {
	const before = queuedTurns.length;
	queuedTurns = queuedTurns.filter(t => t.id !== id);
	if (queuedTurns.length !== before) {
		log.info('Subprocess', 'cancelQueued', { id, remaining: queuedTurns.length }, '🗑️');
		emitQueueState();
	}
}

// DEMOTE a queued item by id (the card's ⬇): remove it from the queue and hand
// its full text + images + flags back to the webview so it can repopulate the
// prompt input for editing. Nothing is silently lost.
export function demoteQueued(id: string): void {
	if (!deps) { return; }
	const item = queuedTurns.find(t => t.id === id);
	if (!item) {
		log.debug('Subprocess', 'demoteQueued — id not found', { id }, '🤷');
		return;
	}
	queuedTurns = queuedTurns.filter(t => t.id !== id);
	log.info('Subprocess', 'demoteQueued', { id, remaining: queuedTurns.length }, '⬇️');
	emitQueueState();
	deps.postMessage({
		type: 'queuedDemoted',
		data: {
			message: item.message,
			planMode: !!item.planMode,
			images: (item.images || []).map(img =>
				typeof img === 'string' ? { filePath: img } : { filePath: img.filePath, previewUri: img.previewUri }
			),
		},
	});
}

// SKULL (hard): kill the process group (takes subagents) and PARK the session to
// history so the UI can offer recycle/resume. Today's old hard-kill behavior.
export async function skullProcess(): Promise<void> {
	log.info('Subprocess', 'enter skullProcess (hard kill + park)', undefined, '☠️');
	if (!deps) { return; }

	const parkedSessionId = conversation.getCurrentSessionId();

	userRequestedStop = true;
	isProcessing = false;

	deps.postMessage({
		type: 'setProcessing',
		data: { isProcessing: false }
	});

	await killProcess();
	// killProcess cleared queuedTurns; tell the webview so the peeking card clears.
	emitQueueState();

	deps.postMessage({
		type: 'clearLoading'
	});

	// Park to history so the session can be recycled/resumed (the index entry is
	// maintained per-message; ensure the UI shows the parked affordance).
	await conversation.parkToHistory();

	deps.postMessage({
		type: 'sessionParked',
		data: { sessionId: parkedSessionId }
	});

	conversation.sendAndSaveMessage({
		type: 'notice',
		data: { title: 'Killed', content: 'Session killed. Resume from History to continue.', variant: 'warning' }
	});
}

export function forceShutdown(): void {
	const pid = currentClaudeProcess?.pid;
	log.info('ClaudeProcess', 'forceShutdown', { pid }, '🛑');
	try { abortController?.abort(); } catch { /* ignore */ }
	abortController = undefined;
	currentClaudeProcess = undefined;
	spawnedPlanMode = undefined;
	queuedTurns = [];
	cachedModels = undefined;
	cachedCommands = undefined;
	disarmStallWatchdog();
	rejectAllPendingControl('force shutdown');
	sessionLock.release();
	if (typeof pid === 'number' && pid > 0) {
		try {
			if (process.platform === 'win32') {
				process.kill(pid, 'SIGTERM');
			} else {
				try { process.kill(-pid, 'SIGTERM'); } catch { process.kill(pid, 'SIGTERM'); }
			}
		} catch { /* already dead */ }
	}
}

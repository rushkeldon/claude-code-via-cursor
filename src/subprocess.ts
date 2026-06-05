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
// Turns that arrived while a turn was already in flight; flushed at turn end.
let queuedTurns: Array<{
	message: string;
	planMode?: boolean;
	thinkingMode?: boolean;
	images?: Array<string | { filePath: string; previewUri?: string }>;
}> = [];

// ── Per-process stdout/stderr + auth/stall state ──────────────────────────
// These accumulate for the life of the warm process (reset on each spawn), not
// per turn — the stream is continuous across turns on one process.
let rawOutput = '';
let errorOutput = '';
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
const STALL_KILL_MS = 120_000;

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

export function isActive(): boolean {
	return !!isProcessing;
}

export function isSilentQueryInFlight(): boolean {
	return silentQueryCallback !== null;
}

export function clearSilentQuery(): void {
	silentQueryCallback = null;
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
export async function sendMessage(message: string, planMode?: boolean, thinkingMode?: boolean, images?: Array<string | { filePath: string; previewUri?: string }>): Promise<void> {
	if (!deps) { return; }

	log.info('ClaudeProcess', 'sendMessage', {
		textLen: message?.length,
		text: message,
		planMode: !!planMode,
		thinkingMode: !!thinkingMode,
		imageCount: images?.length ?? 0,
		model: settings.getSelectedModel(),
		session: conversation.getCurrentSessionId(),
		processing: !!isProcessing,
		hasLiveProcess: !!currentClaudeProcess,
	}, '💬');

	if (isProcessing) {
		// A turn is already in flight — queue rather than spawn a second child.
		queuedTurns.push({ message, planMode, thinkingMode, images });
		log.info('ClaudeProcess', 'turn queued (turn in flight)', { queueLen: queuedTurns.length }, '⏸️');
		return;
	}

	await runTurn({ message, planMode, thinkingMode, images });
}

interface Turn {
	message: string;
	planMode?: boolean;
	thinkingMode?: boolean;
	images?: Array<string | { filePath: string; previewUri?: string }>;
}

async function runTurn(turn: Turn): Promise<void> {
	if (!deps) { return; }
	const { message, planMode, thinkingMode, images } = turn;

	const configThink = vscode.workspace.getConfiguration('claudeCodeChat');
	const thinkingIntensity = configThink.get<string>('thinking.intensity', 'think');

	let actualMessage = message;
	if (thinkingMode) {
		let thinkingPrompt = '';
		const thinkingMesssage = ' THROUGH THIS STEP BY STEP: \n'
		switch (thinkingIntensity) {
			case 'think':
				thinkingPrompt = 'THINK';
				break;
			case 'think-hard':
				thinkingPrompt = 'THINK HARD';
				break;
			case 'think-harder':
				thinkingPrompt = 'THINK HARDER';
				break;
			case 'ultrathink':
				thinkingPrompt = 'ULTRATHINK';
				break;
			default:
				thinkingPrompt = 'THINK';
		}
		actualMessage = thinkingPrompt + thinkingMesssage + actualMessage;
	}

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
	const needSpawn = !currentClaudeProcess || !stdinUsable || planModeChanged;

	if (needSpawn) {
		if (currentClaudeProcess) {
			// Stale/closing handle or a plan-mode toggle — reap before respawn so
			// we never have two children attached to the same session at once.
			// killProcess() clears queuedTurns (correct for an explicit stop), but
			// here we're mid-drain — preserve any turns still waiting behind this one.
			log.info('ClaudeProcess', 'respawn required', { planModeChanged, stdinUsable }, '♻️');
			const preserved = queuedTurns;
			await killProcess();
			queuedTurns = preserved;
		}
		const ok = await spawnProcess(!!planMode);
		if (!ok) {
			// Synchronous spawn failure — don't leave the turn stuck "processing".
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

	// Intentionally NOT passing --model. The extension manages the model by
	// writing to .claude/settings.local.json (see settings.ts), letting the CLI
	// resolve it through its own settings hierarchy (project settings.local.json
	// → global settings.json). Passing --model here would override the user's
	// configured model (e.g. forcing Opus 4.6 over their pinned opus-4-8[1m]).

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

	// Reset per-process accumulators (the stream is continuous across turns on
	// this process; these belong to the process, not the turn).
	rawOutput = '';
	errorOutput = '';
	authErrorFired = false;

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

		if (authErrorFired) {
			currentClaudeProcess = undefined;
			spawnedPlanMode = undefined;
			queuedTurns = [];
			permissions.cancelPendingPermissionRequests();
			deps!.postMessage({ type: 'clearLoading' });
			isProcessing = false;
			deps!.postMessage({ type: 'setProcessing', data: { isProcessing: false } });
			return;
		}

		currentClaudeProcess = undefined;
		spawnedPlanMode = undefined;
		queuedTurns = [];

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

		currentClaudeProcess = undefined;
		spawnedPlanMode = undefined;
		queuedTurns = [];

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
		// Defer to the next idle boundary (applied in onTurnEnd).
		pendingModelSwitch = model;
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
	isProcessing = false;
	disarmStallWatchdog();
	deps.postMessage({ type: 'setProcessing', data: { isProcessing: false } });
	flushPendingSilentQuery();

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

	if (queuedTurns.length > 0) {
		const next = queuedTurns.shift()!;
		log.info('ClaudeProcess', 'flushing queued turn', { remaining: queuedTurns.length }, '▶️');
		void runTurn(next);
	}
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
				conversation.setCurrentSessionId(jsonData.session_id);
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
				if (jsonData.message.model) {
					deps.postMessage({ type: 'modelResolved', model: jsonData.message.model });
				}
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
					conversation.setCurrentSessionId(jsonData.session_id);

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
				if (jsonData.total_cost_usd) {
					tokenCounters.addTokens(0, 0, jsonData.total_cost_usd);
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
						currentCost: jsonData.total_cost_usd,
						currentDuration: jsonData.duration_ms,
						currentTurns: jsonData.num_turns
					}
				});

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
				onTurnEnd();
			}
		}, 6_000);
	} catch (e: any) {
		// Interrupt didn't land — escalate to a hard kill (Skull behavior).
		log.warn('Subprocess', 'interrupt failed — escalating to hard kill', { error: e?.message ?? String(e) }, '⚠️');
		await skullProcess();
	}
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

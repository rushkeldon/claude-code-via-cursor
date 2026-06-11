import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { log } from './logger';

// Mode-state mirror for the prompt mode picker.
//
// The `modes` skill records the active mode(s) in `active_modes.md` inside
// Claude's per-project auto-memory directory. That file is the single source of
// truth; the pill must reflect it, never an optimistic click. We don't derive
// the path (the encoding is a CLI-internal convention) — instead it's discovered
// from the CLI's own tool-call stream (subprocess sees a Read/Write whose
// file_path ends in active_modes.md), cached in workspaceState, then read +
// FileSystemWatcher'd. See doc/archive/mode_state.plan.md.
//
// plan↔agent is a mutex, so the pill mode is exactly one of 'agent' | 'plan'.
// A missing/empty/unreadable file means no modes → display the default, 'agent'.

type PostMessageFn = (message: any) => void;

const PATH_CACHE_KEY = 'claude.activeModesPath';

let postMessage: PostMessageFn | undefined;
let workspaceState: vscode.Memento | undefined;
let subscriptions: { push(d: vscode.Disposable): void } | undefined;

let activeModesPath: string | undefined;
let watcher: vscode.FileSystemWatcher | undefined;

export function init(deps: {
	postMessage: PostMessageFn;
	workspaceState: vscode.Memento;
	subscriptions: { push(d: vscode.Disposable): void };
}): void {
	log.info('Modes', 'init', undefined, '🔧');
	postMessage = deps.postMessage;
	workspaceState = deps.workspaceState;
	subscriptions = deps.subscriptions;

	// If we learned the path in a previous session, start mirroring immediately —
	// no subprocess spawn or model round-trip required.
	const cached = workspaceState.get<string>(PATH_CACHE_KEY);
	if (cached) {
		log.debug('Modes', 'init: using cached path', { cached }, '📥');
		startWatching(cached);
		readAndPushActiveMode(cached);
	}
}

// Re-push the current mode to the webview. Called on `webviewReady`: the startup
// read in init() fires during activate(), BEFORE the webview has mounted its
// message listeners, so that push is lost. The webview re-requests state on
// mount via this. Falls back to the default ('agent') push if no path is known
// yet, so the pill is at least explicitly set rather than relying on its initial
// signal value.
export function resync(): void {
	if (activeModesPath) {
		readAndPushActiveMode(activeModesPath);
	} else {
		log.debug('Modes', 'resync: no path known yet, pushing default', undefined, '📤');
		postMessage?.({ type: 'setActiveMode', data: { mode: 'agent' } });
	}
}

// Derive the pill mode from active_modes.md contents. 'plan' iff a top-level
// `- plan` entry exists (with or without a `: dir` param); otherwise 'agent'.
export function pillModeFromFile(text: string): 'agent' | 'plan' {
	return /^\s*-\s*plan\b/m.test(text) ? 'plan' : 'agent';
}

// True once we know where active_modes.md lives (cached from a prior session or
// discovered this session). Used to gate the one-shot silent discovery query.
export function isPathKnown(): boolean {
	return !!activeModesPath;
}

// Silent discovery query, fired once per session at an idle boundary when the
// path is still unknown (cold cache — no /modes command has run). We ask for the
// PATH rather than "what modes are active", because active_modes.md is already in
// the model's context (via MEMORY.md), so it would answer the latter WITHOUT a
// Read tool call — leaving nothing for the stream sniff to catch. Asking for the
// path is answered from the system prompt's auto-memory section directly.
export const MODE_DISCOVERY_PROMPT =
	'Quick internal question, not shown to the user and unrelated to the task: ' +
	'what is the absolute filesystem path to your active_modes.md auto-memory ' +
	'file? Reply with only the path — no prose, no quotes, no backticks.';

// Parse the discovery answer for an active_modes.md path and adopt it (cache +
// watch + push the real mode). Best-effort: a junk/empty answer is ignored by the
// suffix guard in notePathFromStream, so the pill simply stays at its default.
export function noteDiscoveredPathFromAnswer(answer: string): void {
	if (!answer) { return; }
	const m = answer.match(/(\/[^\s'"`]*active_modes\.md)/);
	if (m) {
		log.info('Modes', 'discovered active_modes.md path from silent query', { path: m[1] }, '🔎');
		notePathFromStream(m[1]);
	} else {
		log.debug('Modes', 'discovery answer had no usable path', { answer }, '🤔');
	}
}

// Called by the subprocess stream parser whenever a tool call touches a file
// path ending in active_modes.md. Idempotent: only re-wires the watcher when the
// path is genuinely new. Always re-reads so a Write we just saw is reflected.
export function notePathFromStream(filePath: string): void {
	if (!/(^|\/|\\)active_modes\.md$/.test(filePath)) {
		return;
	}
	if (filePath !== activeModesPath) {
		log.info('Modes', 'discovered active_modes.md path from stream', { filePath }, '🔎');
		workspaceState?.update(PATH_CACHE_KEY, filePath);
		startWatching(filePath);
	}
	readAndPushActiveMode(filePath);
}

// Read the file (best-effort) and push the derived mode to the webview. Never
// throws — a missing/unreadable file resolves to the default mode.
export function readAndPushActiveMode(p: string): void {
	let mode: 'agent' | 'plan' = 'agent';
	try {
		const text = fs.readFileSync(p, 'utf8');
		mode = pillModeFromFile(text);
	} catch {
		mode = 'agent';
	}
	log.debug('Modes', 'readAndPushActiveMode', { p, mode }, '📤');
	postMessage?.({ type: 'setActiveMode', data: { mode } });
}

// (Re)create the FileSystemWatcher for the given file. Disposes any prior
// watcher first so we never stack watchers if the path changes.
function startWatching(p: string): void {
	if (activeModesPath === p && watcher) {
		return;
	}
	watcher?.dispose();
	activeModesPath = p;
	const w = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(vscode.Uri.file(path.dirname(p)), path.basename(p))
	);
	const reread = () => readAndPushActiveMode(p);
	w.onDidChange(reread);
	w.onDidCreate(reread);
	w.onDidDelete(reread); // deletion → no modes → default 'agent'
	watcher = w;
	subscriptions?.push(w);
	log.debug('Modes', 'watching', { p }, '👀');
}

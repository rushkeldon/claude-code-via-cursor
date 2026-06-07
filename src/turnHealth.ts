// ── Turn-health monitor (event-driven; replaces the wall-clock stall watchdog) ──
//
// The old watchdog judged turn health from a clock: 30s silent → "stalled" card,
// 60s → auto-continue nudge, 120s → kill. That mis-fires on exactly the turns
// this product exists for — a hard Opus deep-think is legitimately silent for
// >60s while *thinking*, and a wall-clock can't tell "thinking hard" from
// "wedged." See doc/archive/health_monitor.plan.md.
//
// This monitor derives a TURN-ACTIVITY state purely from the real stream events
// (the heartbeat) and dispatches it to the webview, which renders it. It owns NO
// health timer — the ONLY timer here is a short presentation-only debounce that
// de-jitters the pulse (active → quiet) so a momentary gap between deltas doesn't
// flicker the indicator. That debounce fires NO action (no card, no nudge, no
// kill) — it is purely a visual cue meaning "no bytes right now," shown honestly.
//
// Process health (spawn / close / error / auth) stays in subprocess.ts where it's
// already event-driven and correct; this monitor only consumes turn-level events.

import { log } from './logger';

// The benign "spinning up / thinking before first token" window (user message
// written, no stream event yet) MUST read as working, never as stalled — it's
// the exact window that broke the old watchdog. `active` = a heartbeat arrived
// recently; `quiet` = turn still open but no bytes for a short debounce (honest
// "no output right now," NOT a stall verdict); `done`/`errored` = terminal.
export type TurnState = 'opening' | 'active' | 'quiet' | 'done' | 'errored';

// What kind of heartbeat is flowing, so the indicator can say *what* is happening
// (Thinking / Composing tool call… / Responding / Compacting) instead of a
// generic "Processing." Free now that we listen for every heartbeat.
export type ActivityKind = 'thinking' | 'text' | 'tool' | 'compacting';

// Heartbeat signals the monitor accepts, mapped from the stream events in
// subprocess.ts (processJsonStreamData). `tool_result` is the heartbeat that a
// long, silent tool call has returned; `error` marks an error result.
export type Signal =
	| 'thinking_start'
	| 'thinking_delta'
	| 'text_delta'
	| 'text_start'
	| 'tool_use'
	| 'tool_result'
	| 'message_start'
	| 'compacting'
	| 'error';

type PostMessageFn = (message: any) => void;

// Short visual debounce: how long after the last heartbeat before the pulse
// settles from `active` to `quiet`. Presentation only — long enough not to
// flicker between deltas, short enough that a genuine gap reads as "quiet" soon.
const QUIET_DEBOUNCE_MS = 2_000;

let post: PostMessageFn | undefined;
let state: TurnState = 'done';
let kind: ActivityKind | undefined;
// True while a tool_use is outstanding (no tool_result yet). A turn awaiting a
// tool is legitimately silent — we suppress the active → quiet debounce so a long
// bash/web/subagent call never reads as "quiet/suspicious."
let awaitingTool = false;
let quietTimer: NodeJS.Timeout | undefined;

export function init(postMessage: PostMessageFn): void {
	post = postMessage;
}

function clearQuietTimer(): void {
	if (quietTimer) { clearTimeout(quietTimer); quietTimer = undefined; }
}

// Emit the current turn-activity state to the webview. Only posts on a real
// change (state or kind) so we don't spam the bus with identical heartbeats.
let lastPosted = '';
function emit(): void {
	const key = `${state}:${kind ?? ''}`;
	if (key === lastPosted) { return; }
	lastPosted = key;
	post?.({ type: 'turnActivity', data: { state, kind } });
	log.debug('TurnHealth', 'turnActivity', { state, kind, awaitingTool }, '💓');
}

// Arm the presentation-only debounce. When it fires (no heartbeat for
// QUIET_DEBOUNCE_MS) the pulse settles to `quiet` — UNLESS we're awaiting a tool
// (its silence is expected). Fires NO action; it only changes the displayed cue.
function armQuietDebounce(): void {
	clearQuietTimer();
	if (awaitingTool) { return; }
	quietTimer = setTimeout(() => {
		quietTimer = undefined;
		if (state === 'active') {
			state = 'quiet';
			emit();
		}
	}, QUIET_DEBOUNCE_MS);
}

// A turn was just written to stdin — open the monitor in its benign `opening`
// state (no stream event yet). This window must look like work, not a stall.
export function beginTurn(): void {
	clearQuietTimer();
	awaitingTool = false;
	state = 'opening';
	kind = undefined;
	emit();
}

// A heartbeat arrived. Map it to an activity kind, flip to `active`, and re-arm
// the visual debounce. This is the real pulse — including text_delta,
// input_json_delta (tool-arg assembly), and message_start, all dropped by the
// old design, which is why healthy turns looked "silent."
export function signal(sig: Signal): void {
	switch (sig) {
		case 'error':
			clearQuietTimer();
			awaitingTool = false;
			state = 'errored';
			kind = undefined;
			emit();
			return;
		case 'tool_use':
			awaitingTool = true;
			kind = 'tool';
			break;
		case 'tool_result':
			awaitingTool = false;
			kind = 'tool';
			break;
		case 'thinking_start':
		case 'thinking_delta':
			kind = 'thinking';
			break;
		case 'text_start':
		case 'text_delta':
			kind = 'text';
			break;
		case 'compacting':
			kind = 'compacting';
			break;
		case 'message_start':
			// Envelope lifecycle — a heartbeat, but don't claim a specific kind.
			break;
	}
	// Any heartbeat means the turn is alive right now.
	if (state !== 'active') {
		state = 'active';
	}
	emit();
	armQuietDebounce();
}

// The turn reached a terminal `result`. Settle to `done` (idle/ready) unless the
// turn already went `errored` (an error result fires signal('error') first, then
// onTurnEnd calls this — don't clobber the error state).
export function endTurn(): void {
	clearQuietTimer();
	awaitingTool = false;
	if (state !== 'errored') {
		state = 'done';
		kind = undefined;
		emit();
	}
}

// Hard reset: process died / killed / aborted / login required. Drop to `done`
// (the status resolver folds in the dead/disconnected process state separately,
// so we just need the pulse to stop) and clear all internal turn state.
export function reset(): void {
	clearQuietTimer();
	awaitingTool = false;
	state = 'done';
	kind = undefined;
	emit();
}

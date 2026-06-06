---
name: User-paused session — friendly notice instead of abort error
overview: >
  Clicking + (new session) or resuming from History tears down the in-flight
  subprocess, which aborts the running turn and surfaces a scary red
  "Error running Claude: The operation was aborted" card in the (saved)
  transcript. That abort is the expected result of a deliberate user action, not
  an error. Set a flag when the user pauses a session this way, and have the
  abort-error branch render a yellow `notice` ("Session paused …") instead of the
  red error — then clear the flag so a genuine later abort still shows as an error.
todos:
  - id: add-paused-flag
    content: "Add a module-level `userPausedSession` flag in subprocess.ts (mirrors the existing `userRequestedStop` pattern at ~130). Optionally carry a reason ('new-session' | 'history') so the notice copy can name what happened."
    status: pending
  - id: set-flag-on-pause
    content: "Set userPausedSession=true (with reason) at the deliberate teardown entry points: webview.newSession() and webview.loadConversation() set it just before calling subprocess.killProcess(). These are the + button and History-resume paths."
    status: pending
  - id: downgrade-abort-error
    content: "In subprocess.ts proc.on('error') (~710), add a branch BEFORE the generic error: if userPausedSession is set AND the error is an abort ('The operation was aborted' / AbortError), emit a yellow `notice` (variant: 'warning', title 'Session paused') instead of the red `error` card, then clear userPausedSession. Mirror the existing `userRequestedStop` suppression right beside it."
    status: pending
  - id: notice-copy-by-reason
    content: "Notice copy names the action: new-session → 'Session paused — started a new session.'; history → 'Session paused — switched conversations.' Fallback generic 'Session paused.' if no reason. Reuse the existing notice/NoticeCard machinery (type:'notice', variant:'warning')."
    status: pending
  - id: flag-hygiene
    content: "Clear userPausedSession defensively so it can't leak into a later real abort: clear it when consumed in the error branch, and also reset it on a fresh successful spawn / first result (belt-and-suspenders), and in killProcess teardown if appropriate. A real abort that happens without the flag set must still render as a red error."
    status: pending
  - id: version-bump
    content: "Bump appcloud9.X in package.json to the NEXT version before packaging (read current value, increment — do not hard-code)."
    status: pending
  - id: build-install
    content: "npm run compile, package the VSIX (vsce --no-dependencies), install with cursor --install-extension --force. Confirm installed version matches built version before reload."
    status: pending
  - id: verify
    content: "Verify in-app: click + mid-turn → the paused session's transcript shows a YELLOW 'Session paused — started a new session' notice, NOT a red error; resume from History mid-turn → yellow 'switched conversations' notice; a genuine abort/crash with the flag unset still shows the red error; Stop still shows its own 'Stopped' notice (unchanged); the flag does not leak (a real error on the very next turn is still red)."
    status: pending
isProject: false
---

# User-paused session — friendly notice instead of abort error

## Background

The **+** button means "I want a new session," and **History-resume** means "load
this other conversation." Both deliberately tear down the in-flight subprocess
via `subprocess.killProcess()`, which calls `abortController.abort()`
([subprocess.ts](../src/subprocess.ts) ~1470). That aborts the spawned process's
`signal` (~507/518), firing `proc.on('error')` with *"The operation was
aborted"*, which currently renders as a **red ERROR card**:

```
⚠️ ERROR
Error running Claude: The operation was aborted
```

(Confirmed via screenshot, 2026-06-04.) That abort is the **expected
consequence of a deliberate user action**, not a failure — but it lands as a
scary red error in the conversation's saved transcript, littering the history of
every paused session.

There is already a precedent for this exact situation: **Stop** sets
`userRequestedStop` (~1655) and the `proc.on('error')` handler suppresses the
error card for it (~710-711). This feature adds the same idea for the
pause-by-navigation case, but instead of *suppressing* the message, it
*downgrades* it to a friendly yellow notice.

## Approach

A small, contained flag + branch, mirroring `userRequestedStop`:

1. Add a `userPausedSession` flag (with an optional reason) in `subprocess.ts`.
2. Set it at the deliberate teardown entry points — `webview.newSession()`
   (the **+** button) and `webview.loadConversation()` (History-resume) — just
   before they call `killProcess()`.
3. In `proc.on('error')`, add a branch **before** the generic red-error fallback:
   if `userPausedSession` is set and the error is an abort, emit a yellow
   `notice` (`variant: 'warning'`) naming the action, then clear the flag.

The yellow notice reuses the existing `notice` message type +
[NoticeCard](../src/webview/components/NoticeCard/NoticeCard.tsx) (the same
machinery already used for "Stopped", "Interrupted", "Killed", and the YOLO
banner). No new component or message type is required.

## Files to modify

- [src/subprocess.ts](../src/subprocess.ts) —
  - add `let userPausedSession: { reason: 'new-session' | 'history' } | null = null;`
    near `userRequestedStop` (~130);
  - in `proc.on('error')` (~710), add the downgrade branch (see below);
  - clear the flag on consume + defensively on a fresh spawn / first result.
- [src/webview.ts](../src/webview.ts) —
  - `newSession()` (~164): set the flag (reason `'new-session'`) before
    `await subprocess.killProcess()` (~166);
  - `loadConversation()` (~159): set the flag (reason `'history'`) before
    `await subprocess.killProcess()` (~160).
  - Use a small exported setter on subprocess (e.g.
    `subprocess.markUserPaused(reason)`) rather than reaching into module state.
- [package.json](../package.json) — bump `appcloud9.X` to the **next** version.

## Implementation details

### The flag + setter (subprocess.ts ~130)

```ts
let userPausedSession: { reason: 'new-session' | 'history' } | null = null;

export function markUserPaused(reason: 'new-session' | 'history'): void {
	userPausedSession = { reason };
}
```

### The downgrade branch (subprocess.ts proc.on('error') ~705-717)

Insert before the final `else` that emits the red error. Keep the existing
`ENOENT`/install-modal and `userRequestedStop` branches:

```ts
} else if (userRequestedStop) {
	userRequestedStop = false;
} else if (userPausedSession && isAbortError(error)) {
	const reason = userPausedSession.reason;
	userPausedSession = null;
	conversation.sendAndSaveMessage({
		type: 'notice',
		data: {
			title: 'Session paused',
			content: reason === 'history'
				? 'Session paused — switched conversations.'
				: 'Session paused — started a new session.',
			variant: 'warning',
		},
	});
} else {
	conversation.sendAndSaveMessage({
		type: 'error',
		data: `Error running Claude: ${error.message}`,
	});
}
```

with a small helper:

```ts
function isAbortError(error: Error): boolean {
	return /aborted/i.test(error.message) || (error as any).name === 'AbortError';
}
```

### Setting the flag (webview.ts)

```ts
// newSession() — the + button
subprocess.markUserPaused('new-session');
await subprocess.killProcess();

// loadConversation() — History-resume
subprocess.markUserPaused('history');
await subprocess.killProcess();
```

### Flag hygiene

- **Consume-and-clear:** the downgrade branch nulls the flag immediately.
- **Defensive reset:** also clear `userPausedSession` on a fresh successful
  spawn and/or first `result` of a new turn, so a stale flag (e.g. if the abort
  error never fired for some reason) cannot downgrade a *genuine* abort on a
  later turn.
- A real abort with the flag unset still renders red — unchanged behavior.

## Edge cases

- **+ vs History wording:** the reason field differentiates the copy; a missing
  reason falls back to a generic "Session paused."
- **Stop is unaffected:** Stop uses `userRequestedStop` (suppresses the message
  entirely) and its own 'Stopped' notice — leave that path exactly as is. The new
  branch is ordered after the `userRequestedStop` check so Stop never reaches it.
- **Non-abort error while paused:** `isAbortError` gates the downgrade, so a
  real spawn failure (ENOENT, etc.) during a pause still shows correctly (the
  ENOENT/install-modal branch already runs first anyway).
- **Flag leak across turns:** covered by the defensive reset — verify a genuine
  error on the turn *after* a pause still renders red.
- **Saved transcript:** because we `sendAndSaveMessage`, the yellow notice
  replaces the red error in the persisted conversation too — which is the main
  point (clean history for paused sessions).
- **Skull:** uses its own 'Killed' notice path; not in scope and not affected.

## What we are NOT doing

- Not changing the teardown/abort mechanics themselves (`killProcess` /
  `abortController`) — only how the resulting abort is *presented*.
- Not adding a new message type or component — reuse `notice` + `NoticeCard`.
- Not touching the Stop or Skull notice paths.
- Not suppressing genuine abort errors — only the ones immediately following a
  deliberate user pause (flag-gated + abort-gated).

## Open questions

- **Exact abort message string:** the screenshot shows "The operation was
  aborted"; confirm the live `error.message` (and/or `error.name === 'AbortError'`)
  during implementation so `isAbortError` matches reliably.
- **Does the aborted turn also emit a `result` (error_during_execution) path?**
  The interrupt/Stop flow notes a `result` error_during_execution can follow
  (subprocess.ts ~1512/1542). Verify the + / History abort surfaces via
  `proc.on('error')` (as the screenshot implies) and not *also* via a `result`
  error branch — if both, the downgrade may need to cover the `result` path too.
- **Reason granularity:** is "switched conversations" the right phrase for
  History-resume, or should it name the target session? Generic is simpler;
  decide during verify.

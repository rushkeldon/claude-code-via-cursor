---
name: Auto-continue dropped turns (incomplete-turn watchdog)
overview: >
  Detect when a turn stops producing output but never emits a terminal `result`
  event (the "you said something, a tool ran, then it just stops" failure), and
  automatically inject one invisible "please continue" to recover — capped and
  escalating to a visible card so it never loops silently or hides a real error.
  Nests into the existing silence-based stall watchdog as a new threshold between
  its notify (30s) and kill (120s) stages.
todos:
  - id: tool-inflight-tracking
    content: "Track whether a tool is actively running (saw tool_use, no matching tool_result yet) so the auto-continue never fires during a legitimately long bash/web tool — only when the stream is genuinely idle mid-turn."
    status: pending
  - id: dont-recover-real-errors
    content: "Record the last result subtype / error signals (error_during_execution, auth-required, refusal) so a turn that ended on a genuine error is NOT auto-continued (that's a known-bad end, not a dropped turn)."
    status: pending
  - id: auto-continue-threshold
    content: "Add a 60s silence threshold to armStallWatchdog (between STALL_NOTIFY_MS 30s and STALL_KILL_MS 120s) that fires the auto-continue when processing, not tool-in-flight, not error-ended, and no result has arrived."
    status: pending
  - id: invisible-continue-injection
    content: "Inject a 'Please continue.' user turn directly to stdin WITHOUT rendering it in the UX and without disturbing isProcessing/queue. Cannot reuse sendSilentQuery as-is (it requires !isProcessing and routes through the silent-query guard); write a dedicated injectContinue() that writes the stdin message and re-arms the watchdog."
    status: pending
  - id: retry-cap
    content: "Cap auto-continues at 1 (configurable const, default 1) per turn. Reset the counter when a real result arrives or a new user turn starts. After the cap, fall through to the existing 120s kill OR surface a visible 'turn stalled — auto-continue didn't recover' card."
    status: pending
  - id: escalation-card
    content: "When the cap is exhausted and the turn still hasn't produced a result, show a visible notice (not silent) so the user is never left silently stuck or silently looping. Distinguish from the existing processKilled card."
    status: pending
  - id: logging
    content: "Log each stage (auto-continue armed / fired / recovered / cap-exhausted) with distinct strings so the behavior is greppable in the host logs, like the existing stall watchdog warnings."
    status: pending
  - id: version-bump
    content: "Bump appcloud9.X to the next version in package.json before packaging."
    status: pending
isProject: false
---

# Auto-continue dropped turns (incomplete-turn watchdog)

## Background

Occasionally a turn in this extension stops mid-flight: the user sends a message,
Claude streams some output and maybe runs a tool, and then it just stops — no
final answer, no error, the UI sits "processing" forever until the user manually
Stops or reloads the window. We saw this repeatedly in the 2026-06-05/06 session
logs (e.g. `no result after sendNow interrupt — forcing turn end`, and turns that
emitted a `signature_delta` then `assistant` content and then nothing).

In normal Claude Code (the TUI) a turn reliably comes back. Here it doesn't always,
and the user wants an **automatic, invisible "please continue"** to recover the
dropped turn without manual intervention — the way a human would just nudge it.

### Why this is detectable (and where today's code falls short)

The crux, confirmed in [src/subprocess.ts](../src/subprocess.ts):

- **`onTurnEnd()` fires ONLY on a `result` stream event** (subprocess.ts:1472, plus
  the interrupt fallbacks). It flips `isProcessing` false, disarms the watchdog,
  drains the queue. If the CLI **never emits `result`**, the turn never ends and
  `isProcessing` stays `true` indefinitely. That is the dropped-turn signature.
- **The stall watchdog** (`armStallWatchdog`, subprocess.ts:955) is purely
  **silence-based**: `lastStdoutMs` updates on *any* stdout byte (subprocess.ts:592);
  at `STALL_NOTIFY_MS` (30s) it posts `processStalled` (a UI hint), at
  `STALL_KILL_MS` (120s) it posts `processKilled` and SIGTERMs the process.
- **So a dropped turn DOES eventually go silent** (output stops → `lastStdoutMs`
  stops advancing), which means the silence watchdog already *notices* it — it just
  has no recovery step. Today the only outcomes are "show a hint" (30s) and "kill"
  (120s). There is no "try to nudge it back to life" in between.

This plan adds that middle step.

### Why 60s, not 15s (resolved)

An earlier draft used "no result within ~15s." That's too aggressive: on Opus 4.8
at high effort with a 1M context, the gap between a tool result and the next
assistant token is legitimately 20–40s of thinking (we watched "THINKING… 153.8s"
in-session). Firing at 15s would false-positive constantly on healthy long turns
and risk a token-burning continue loop.

**Decision: 60s of silence**, nested into the existing watchdog thresholds:

| Elapsed silence | Stage | Status |
|---|---|---|
| 30s (`STALL_NOTIFY_MS`) | show "still working" hint | existing |
| **60s** (`STALL_AUTOCONTINUE_MS`) | **one invisible "Please continue."** | **new** |
| 120s (`STALL_KILL_MS`) | hard kill + visible card | existing |

This way the visible hint shows first, the silent recovery is attempted second, and
the hard kill remains the final backstop — all on one clock, no parallel timer.

## Approach

Extend the **existing** silence watchdog rather than building a separate timer
(reuse `lastStdoutMs`, the 5s interval, and the `permissions.hasPending()` reset).
Add a third threshold at 60s that, **only when safe**, injects one invisible
"Please continue." and re-arms — giving the turn a chance to resume and emit its
`result`. If it recovers, normal `onTurnEnd` runs and nobody sees anything. If it
doesn't, the retry cap is hit, we stop nudging, and either the 120s kill fires or
we surface an explicit "stalled, couldn't recover" card.

The hard part is **not** the timer — it's the three guard conditions that keep the
auto-continue from misfiring. Each is its own todo.

### Guard 1 — don't fire during an active tool call (`tool-inflight-tracking`)

A long-running `bash` (a 90s test suite) or `web_fetch` produces **no stdout on the
claude stream** until it completes — indistinguishable from a stuck turn by silence
alone. Track tool-in-flight: set a flag when we see a `tool_use` content block,
clear it when the matching `tool_result` arrives (or on `result`/turn end). While a
tool is in flight, the 60s auto-continue must **not** fire (treat like the existing
`permissions.hasPending()` reset — bump `lastStdoutMs` or skip the threshold).

> Open question: do we reset the silence clock entirely during tool-in-flight, or
> just suppress the auto-continue stage while still allowing the 120s kill? Leaning:
> suppress auto-continue but let kill stand (a tool genuinely hung for 120s is worth
> killing). Confirm during implementation.

### Guard 2 — don't recover a genuine error end (`dont-recover-real-errors`)

If the turn *did* end, but on a bad note — `result` with `is_error`, an
`error_during_execution` subtype, an auth-required result (subprocess.ts:1401–1410
`handleLoginRequired`), or a refusal — that's a **known-bad terminal state**, not a
dropped turn. Auto-continuing it would re-trigger the same failure → continue →
fail forever. Record the last terminal signal; if it was an error, do not
auto-continue. (Note: in the pure dropped-turn case there is *no* result at all, so
this guard mainly prevents continuing *after* an error result that already fired.)

### Guard 3 — cap + escalate (`retry-cap`, `escalation-card`)

- **Cap auto-continues at 1 per turn** (a `const AUTO_CONTINUE_MAX = 1`, easy to
  bump). Reset the counter on a real `result` (in `onTurnEnd`) and on a new user
  turn (`runTurn`).
- After the cap is exhausted and the turn still produces no `result`, **stop
  nudging** and let the 120s kill fire — OR surface a visible card first. Either
  way the user ends up with a clear signal, never a silent infinite loop and never
  a silent permanent stall.

### The injection mechanism (`invisible-continue-injection`)

`sendSilentQuery` (subprocess.ts:191) is the closest existing primitive but **can't
be reused as-is**: it early-returns into `pendingSilentQuery` when `isProcessing`
(subprocess.ts:196) — and during a dropped turn `isProcessing` is exactly `true`.
It also routes its result through the `awaitingSilentResult` guard in `onTurnEnd`
(subprocess.ts:1017), which would wrongly skip the queue drain.

Instead add a dedicated `injectContinue()` that:
- writes a minimal user message (`{ type: 'user', message: { role: 'user',
  content: [{ type: 'text', text: 'Please continue.' }] }, ... }`) straight to
  `currentClaudeProcess.stdin` — the same shape `sendSilentQuery` writes;
- does **not** touch `isProcessing` (the turn is still in flight — we're resuming
  it, not starting a new one), does **not** render anything to the UX, does **not**
  enqueue;
- bumps `lastStdoutMs` / re-arms so the watchdog gives the resumed turn a fresh
  window, and increments the auto-continue counter.

The resumed turn's eventual `result` then flows through the normal `onTurnEnd`,
which resets the counter — clean recovery, invisible to the user.

## Files to modify

- [src/subprocess.ts](../src/subprocess.ts) —
  - **Watchdog** (`armStallWatchdog`, ~955): add `STALL_AUTOCONTINUE_MS = 60_000`
    and a `stallAutoContinued` (count) state; in the interval, between the notify
    and kill checks, fire `injectContinue()` when `silentFor > STALL_AUTOCONTINUE_MS`
    AND not tool-in-flight AND not error-ended AND `autoContinueCount < AUTO_CONTINUE_MAX`.
  - **Tool-in-flight**: in `processJsonStreamData`, set a `toolInFlight` flag on a
    `tool_use` content block and clear it on `tool_result` / `result` (Guard 1).
  - **Last-terminal-signal**: capture whether the last `result` was an error
    (Guard 2) where the `result` case is handled (~1400–1473).
  - **`injectContinue()`**: new function near `sendSilentQuery` (~191).
  - **Counter resets**: reset `autoContinueCount` in `onTurnEnd` (~1007) and in
    `runTurn` / send path (~326) when a new user turn begins.
  - **Escalation**: post a new message type (e.g. `turnStalledUnrecovered`) when the
    cap is exhausted (or reuse `processStalled` with a flag).
- [src/webview/vscode.ts](../src/webview/vscode.ts) — add the escalation message to
  `MessageFromExtension` if a new type is used.
- [src/webview/](../src/webview/) — render the escalation card (likely a `notice`
  via the existing `conversation.sendAndSaveMessage({ type: 'notice', ... })` path,
  which needs no new webview component — check whether host-side notice is enough).
- [package.json](../package.json) — bump `appcloud9.X` to the next version.

## Implementation details

Watchdog interval sketch (additions marked):

```ts
const STALL_NOTIFY_MS = 30_000;        // existing
const STALL_AUTOCONTINUE_MS = 60_000;  // NEW
const STALL_KILL_MS = 120_000;         // existing
const AUTO_CONTINUE_MAX = 1;           // NEW — cap per turn

// per-turn state (reset in onTurnEnd + at send):
let autoContinueCount = 0;
let toolInFlight = false;
let lastResultWasError = false;

// inside the setInterval, after the notify block, before the kill block:
const canAutoContinue =
  !toolInFlight &&
  !lastResultWasError &&
  autoContinueCount < AUTO_CONTINUE_MAX;
if (silentFor > STALL_AUTOCONTINUE_MS && canAutoContinue) {
  autoContinueCount++;
  log.warn('StallWatchdog', 'auto-continue firing', { silentFor, attempt: autoContinueCount }, '↩️');
  injectContinue();          // writes "Please continue." to stdin, re-arms
  return;                    // give the resumed turn a fresh window
}
// existing kill block at STALL_KILL_MS, but only if cap already exhausted —
// i.e. if we auto-continued and STILL went silent to 120s, then kill + card.
```

`injectContinue()` sketch:

```ts
function injectContinue(): void {
  if (!currentClaudeProcess?.stdin) return;
  const msg = {
    type: 'user',
    session_id: conversation.getCurrentSessionId() || '',
    message: { role: 'user', content: [{ type: 'text', text: 'Please continue.' }] },
    parent_tool_use_id: null,
  };
  currentClaudeProcess.stdin.write(JSON.stringify(msg) + '\n');
  lastStdoutMs = Date.now();   // fresh window for the resumed turn
  stallNotified = false;
  deps?.postMessage({ type: 'stallHintClear' });  // drop the "still working" hint
  // NOTE: do NOT set isProcessing, do NOT enqueue, do NOT render to UX.
}
```

## Edge cases

- **Tool genuinely hung 120s** — auto-continue suppressed during tool-in-flight, but
  the 120s kill should still fire (a wedged tool is worth killing). Confirm Guard 1
  suppresses *auto-continue* without also suppressing *kill*.
- **Auto-continue itself produces no result** — the resumed turn goes silent again;
  cap is already at 1, so no second nudge → 120s kill + visible card. Good.
- **`result` arrives mid-nudge** (race) — the normal `onTurnEnd` runs, resets the
  counter and disarms; the injected "Please continue." may then be processed as a
  spurious extra turn. Mitigate: only inject when still `isProcessing` and no result
  seen since arming; accept that a late recovery might cost one extra "continue" turn
  (rare, low harm). Note this risk explicitly.
- **User hits Stop during the stall** — `stopProcess` interrupts; the watchdog
  disarms on the resulting `result`/abort. Auto-continue must check
  `userRequestedStop` and bail.
- **Dark-thinking 4.8 wedge** (the known Bedrock issue) — if that manifests as a
  dropped turn, auto-continue may or may not recover it; the cap ensures we try once
  and then surface it rather than loop. Acceptable.
- **Queued prompts behind the stuck turn** — they must NOT drain until the stuck
  turn truly ends. Since we don't touch `isProcessing` or the queue in
  `injectContinue`, the drain still only happens in `onTurnEnd`. Good.

## What we are NOT doing

- **Not replacing the silence watchdog** — we extend it; the 30s hint and 120s kill
  stay.
- **Not auto-continuing genuine errors** (auth, error_during_execution, refusal) —
  Guard 2.
- **Not retrying more than once** by default — `AUTO_CONTINUE_MAX = 1`. Higher
  counts risk token-burn loops; revisit only if one nudge proves insufficient in
  practice.
- **Not showing the "Please continue." in the transcript** — it's an invisible
  recovery nudge, by design.
- **Not trying to perfectly detect "the response didn't come back"** — impossible
  from outside the CLI. We infer from stream shape (silence + no result + not
  tool-in-flight). The cap + escalation make a wrong guess cheap and visible.

## Open questions

- During tool-in-flight: reset the silence clock entirely, or only suppress the
  auto-continue stage while letting the 120s kill stand? (Leaning: suppress
  auto-continue, keep kill.)
- Escalation UX: a host-side `notice` card (no new webview component) vs. a dedicated
  message type? (Leaning: reuse the `notice` path if it renders acceptably.)
- Is "Please continue." the right nudge text, or something more neutral that won't
  derail a turn that was actually almost done? (Alternatives: "continue", or an
  empty/▏marker the CLI treats as "keep going.")
- Should auto-continue be behind a setting (default on) in case it ever misbehaves,
  or hard-wired? (Leaning: a `claudeCodeChat.autoContinue` boolean, default true.)

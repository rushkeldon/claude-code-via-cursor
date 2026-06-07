---
name: Turn health monitor (replace the wall-clock stall watchdog)
overview: >
  Rip out the time-based stall watchdog (30s notice / 60s auto-continue / 120s
  kill) entirely. Replace it with an event-driven TURN health monitor that
  dispatches activity signals derived from the real stream events, and surface
  those through a redesigned status indicator. We faithfully surface what Claude
  Code tells us; we never guess "too long" from a clock.
todos:
  - id: remove-watchdog
    content: "Remove the wall-clock stall watchdog: 30s processStalled notice, 60s auto-continue, 120s kill + the autoContinue setting + StallHint UI"
    status: pending
  - id: turn-activity-monitor
    content: "Build an event-driven turn-activity monitor: derive turn state from stream events (heartbeat), not a timer"
    status: pending
  - id: status-resolver
    content: "Status resolver: combine turn-activity state with the (already event-driven) process-lifecycle state into one indicator state"
    status: pending
  - id: status-redesign
    content: "Rethink the status indicator design + wording (states, colors, copy) to reflect activity vs. idle vs. quiet vs. dead"
    status: pending
isProject: false
---

# Turn health monitor (replace the wall-clock stall watchdog)

## Background

The current stall watchdog ([subprocess.ts](../src/subprocess.ts)
`armStallWatchdog`) is **time-based guesswork** with three stages:

- **30s silent → `processStalled`** → the "Claude hasn't come back" card
  ([StallHint](../src/webview/components/StallHint/StallHint.tsx)).
- **60s silent → auto-continue** → injects an invisible "Continue from where you
  left off." nudge (gated by `claudeCodeChat.autoContinue`, default on).
- **120s silent → kill** → SIGTERM/SIGKILL the process.

**The problem, demonstrated live this session:** a hard reasoning turn (Opus,
high/max effort, big context) is legitimately silent for >60s while *thinking*.
The wall-clock can't tell "thinking hard" from "wedged," so it mis-fires on
exactly the turns this product exists for — popping a red-herring card and, worse,
**injecting a spurious "continue" into a healthy turn** (an intervention, not a
safety net), with the 120s kill threatening to terminate a fine deep-think.

Root cause: **wall-clock silence ≠ stalled.** Silence is the *absence* of events,
and you can't faithfully judge it with a timer. The honest design surfaces the
*real* activity signal and lets its absence be a human-read cue — backed by the
user's own levers (queued-prompt send-now = stop+keep-warm+resend, Stop, skull),
which already give them every control they need. See [vision.md](vision.md):
*surface Claude Code's signal faithfully; don't editorialize.*

## The signal inventory (what the CLI actually sends)

Mapped from the `processJsonStreamData` switch in
[subprocess.ts](../src/subprocess.ts):

**Turn-activity heartbeats (per-turn, fine-grained `stream_event`s):**
| Event / subtype | Means | Surfaced today? |
|---|---|---|
| `content_block_start` (thinking) | thinking block began | ✅ `thinkingBlockStart` |
| `content_block_delta` / `thinking_delta` | thinking streaming | ✅ `thinkingDelta` |
| `content_block_delta` / `text_delta` | response text streaming | ⚠️ only via coarse `assistant`, not as a stream pulse |
| `content_block_delta` / `input_json_delta` | **tool args being composed** (often long, silent) | ❌ dropped |
| `content_block_start` (text / tool_use) | a text/tool block began | ❌ only thinking surfaced |
| `message_start` / `message_delta` / `message_stop` | message envelope lifecycle | ❌ dropped |
| `assistant` / `user` | a full block / tool_result landed | ✅ |
| `system/status: compacting` | compacting (long + silent, legit) | ✅ `compacting` |

**Turn terminal events:** `result` (turn ended), `result.is_error` (errored).

**Process-lifecycle events (already event-driven, already surfaced):**
`system/init` (spawned/handshake ok), process `close` / `error` (died/crashed),
auth failure → `authError`. These are deterministic OS/CLI signals — keep as-is.

**Key insight:** the turn looked "silent" to the watchdog largely because we were
only counting *thinking* deltas as activity and dropping the other heartbeats
(`text_delta`, `input_json_delta`, `message_start`). The fix is to **listen to all
of them.**

## Scope decision: the monitor is for TURNS

The new monitor watches **turn activity** only. **Process health stays where it
is** — the `close`/`error`/`init` handlers are already event-driven and correct;
we do not rebuild them. The monitor *consumes* process state as an input to the
status resolver; it does not own process monitoring. (If a multi-process future
arrives — the skull/kill-all idea — process health may warrant its own monitor;
out of scope now.)

## Approach

### 1. Remove the wall-clock watchdog (`remove-watchdog`)

Delete entirely from [subprocess.ts](../src/subprocess.ts):
- `armStallWatchdog` / `disarmStallWatchdog`, `stallTimer`, `lastStdoutMs`,
  `stallNotified`, `stallKilled`, the `STALL_NOTIFY_MS` / `STALL_AUTOCONTINUE_MS`
  / `STALL_KILL_MS` constants.
- The auto-continue machinery: `injectContinue`, `autoContinueCount`,
  `autoContinueEscalated`, `AUTO_CONTINUE_MAX`, `autoContinueEnabled`, the "Turn
  stalled" escalation notice, and the `processStalled` / `stallHintClear` posts.
- The `claudeCodeChat.autoContinue` **setting** (package.json) — orphaned once the
  feature is gone.

Delete from the webview:
- [StallHint](../src/webview/components/StallHint/StallHint.tsx) component + its
  use in [App.tsx](../src/webview/App.tsx) (`<StallHint />`, import).
- `processStalled` / `stallHintClear` from the `MessageFromExtension` union in
  [vscode.ts](../src/webview/vscode.ts).

Keep untouched: process `close`/`error` handling, `result`/`onTurnEnd`, auth
handling, and the `toolInFlight` flag (still useful as a turn-state input).

> **Execution checks:** (1) confirm nothing else consumes `processStalled` /
> `stallHintClear`; (2) confirm nothing relied on the 120s kill for a genuinely
> wedged/CPU-pinned process (if so, that becomes a *manual* or event path, not a
> revived timer); (3) removing `autoContinue` setting — scrub all readers.

### 2. Event-driven turn-activity monitor (`turn-activity-monitor`)

A small module (host-side) that maintains a **turn-activity state** derived
purely from events — no timers deciding health:

- **`opening`** — user message written, no stream event yet (the benign
  "spinning up / thinking before first token" window — must NOT read as stalled).
- **`active`** — a stream event arrived recently (any of: thinking_delta,
  text_delta, input_json_delta, message_start, content_block_start, tool
  activity). This is the heartbeat.
- **`quiet`** — turn still open (no `result`) but no stream event for a short
  visual debounce. NOT a judgment that it's broken — just "no bytes right now,"
  shown honestly. (A *short* debounce purely to de-jitter the pulse is fine — it
  is presentation smoothing, not a stall verdict, and triggers no action.)
- **`done`** — `result` received. → idle/ready.
- **`errored`** — `result.is_error`. → error.

The monitor **dispatches a signal** on each transition (e.g. a `turnActivity`
message) that the status bar consumes. Crucially: surface `text_delta`,
`input_json_delta`, and `message_start` as activity (they're dropped today), so
"working" reflects the *real* heartbeat, including the long tool-arg-assembly and
pre-first-token windows.

> Open design point: whether `quiet` exists at all, or whether we only ever show
> `active` (turn open) vs `ready` (turn done). The pulse-present/pulse-absent
> distinction is the value-add over today's solid-yellow bracket — but it must be
> framed as information ("no output right now"), never as alarm.

### 3. Status resolver (`status-resolver`)

One place that folds **turn-activity state** + **process-lifecycle state** into
the single value the indicator renders. Precedence:

1. process dead / never-spawned → `disconnected`
2. auth failure → `error`
3. turn `errored` → `error`
4. turn `active` → `working` (pulse)
5. turn `opening` / `quiet` → working-but-no-output (see design)
6. no open turn, process warm → `ready`

Today's indicator ([SessionStatus.tsx](../src/webview/components/SessionStatus/SessionStatus.tsx))
is driven by a single coarse `setProcessing` boolean (yellow at Send, green at
`result`/death) — a *turn-open bracket*, not an activity signal. The resolver
replaces that boolean with the richer combined state.

### 4. Rethink the indicator design + wording (`status-redesign`)

The states are changing, so the visual language should too. Current copy:
"Processing • N tokens • Ns" / "Ready • …" / "Authentication Error" /
"Initializing...". Open questions for the redesign:
- Distinct treatment for **active** (pulsing) vs **quiet/opening** (steady?) vs
  **ready** (calm green) vs **dead** (red) vs **error**.
- Wording: "Processing" → maybe "Working" / "Thinking" / "Streaming"? Should the
  copy reflect *what* heartbeat is flowing (thinking vs. tool vs. text), or stay
  generic? (Could even show "Composing tool call…" when `input_json_delta` is the
  active signal — genuinely informative, and free now that we listen for it.)
- Keep the elapsed timer + token/cost chips (those are fine — they're facts, not
  judgments).

## Edge cases

- **Pre-first-token silence** — the `opening` state must look benign, not stalled.
  This is the exact window that broke the old watchdog.
- **Long tool execution** (`toolInFlight`, bash/web/subagent) — silence here is
  expected; the monitor should treat a turn awaiting a tool_result as active/
  benign, not quiet-suspicious. (`user`/tool_result arrival is the heartbeat.)
- **Compacting** — already surfaced; make sure it reads as a legit busy state, not
  idle.
- **Genuinely wedged turn (process alive, stream truly dead forever)** — by
  design we no longer auto-kill. The user sees the pulse stop and uses Stop/skull/
  resend. Accept the loss of unattended auto-recovery (worth it vs. killing
  healthy deep-thinks).
- **Webview reload mid-turn** — resolver must re-derive state from current facts
  on remount, not assume.

## What we are NOT doing

- **No timers that judge health.** A short *visual debounce* to de-jitter the
  pulse is allowed (presentation only); a timer that fires a card / nudge / kill
  is not.
- **Not auto-continuing** dropped turns anymore — it mis-fires on healthy turns
  and is an unrequested intervention.
- **Not auto-killing** on inactivity — the user's Stop/skull are the kill path.
- **Not rebuilding process monitoring** — the close/error/init handlers already
  do it; the monitor only consumes their state.

## Open questions

- **Is there ever a true zero-event gap** mid-turn (not just pre-first-token)? A
  read-only stream-timing probe (spawn `claude`, hard prompt, timestamp every
  event) would confirm whether `quiet` is ever reached after streaming has begun.
  Decides how much the `quiet` state matters.
- **Does `quiet` earn its place**, or is `active` vs `ready` enough? (Design call
  in item 4.)
- **The 120s kill's one legit job** — is there any real scenario (wedged process
  pinning resources) where losing the hard kill hurts? If so, design a
  manual/event replacement, not a timer.

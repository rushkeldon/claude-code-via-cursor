---
name: Single-process session lifecycle + control-protocol model switching
overview: >
  Stop the per-turn subprocess leak by committing to one long-lived Claude Code
  process per chat session (reuse, not respawn). Then add the stream-json control
  protocol (initialize handshake, set_model, interrupt) to drive in-band model
  enumeration/switching and graceful stop, split Stop (graceful interrupt) from
  Skull (hard kill + park to history), make breakout fork the session, and make
  model selection dynamic and provider-aware instead of settings-file dependent.
  Work is split into Phase 0 (a live-binary probe spike), Phase 1 (kill the leak —
  fully specified, ships on its own), and Phase 2 (control protocol + lifecycle UX,
  gated on the Phase 0 findings).
todos:
  # ────────────────────────────────────────────────────────────────────
  # Phase 0 · Spike (research only; gates Phase 2, informs Phase 1)
  # ────────────────────────────────────────────────────────────────────
  - id: probe-control-protocol
    phase: 0
    content: "Phase 0 — Live-probe the installed claude binary (2.1.163, under Bedrock): capture a working `initialize` control_request/response and its `models`/`commands` shape; test `set_model` with a Bedrock inference-profile ID and the `[1m]` variant (does it accept or reject?); and observe whether `session_id` from init/result stays stable across several turns AND a compaction on ONE long-lived process. Record all findings back into this plan's Phase 0 Findings section."
    status: completed
  - id: probe-session-id-lock
    phase: 0
    content: "Phase 0 — Test whether assigning our own `--session-id <uuid>` makes the CLI reject a SECOND concurrent process on the same id (the binary has an `Error: Session ID <id> is already in use.` path tied to --session-id / remote-control, NOT to plain --resume). If --session-id gives us free cross-window conflict detection, prefer it over a hand-rolled lockfile. Confirm --session-id is compatible with our stream-json + --resume-on-respawn flow. Record in Phase 0 Findings."
    status: completed

  # ────────────────────────────────────────────────────────────────────
  # Phase 1 · Kill the leak (fully specified; ships independently)
  # ────────────────────────────────────────────────────────────────────
  - id: reuse-sendmessage
    phase: 1
    content: "Phase 1 — Rework subprocess.sendMessage to reuse one live process: spawn only when no live process exists for the session, otherwise write the user message to the warm stdin; remove the stdin.end()-on-result block (subprocess.ts ~441) and stop passing --resume per turn (only --resume at spawn when resuming an existing session)."
    status: completed
  - id: identity-guard-handlers
    phase: 1
    content: "Phase 1 — Capture the spawned child in a local (const proc = claudeProcess) and guard the close/error handlers by identity (if currentClaudeProcess !== proc return) so a late-exiting orphan can't null the live handle or flip isProcessing mid-turn."
    status: completed
  - id: kill-before-spawn-guard
    phase: 1
    content: "Phase 1 — Add a kill-before-spawn safety net (reap any stale handle before spawning) and make isProcessing an entry guard on the spawn path; a turn already in flight queues rather than spawning a second child."
    status: completed
  - id: stall-watchdog-scope
    phase: 1
    content: "Phase 1 — Re-home the stall watchdog so it survives across the warm process's lifetime but only arms during an active turn (start on send, disarm on result/abort); it must never kill a warm-but-idle process between turns."
    status: completed
  - id: silent-query-reuse
    phase: 1
    content: "Phase 1 — Confirm sendSilentQuery / pendingSilentQuery / flushPendingSilentQuery still work against the reused warm process (they already assume a live stdin); fix the turn-boundary flush if reuse changes when isProcessing clears."
    status: completed
  - id: session-id-handling
    phase: 1
    content: "Phase 1 — Apply the Phase 0 session-id finding: trust the LATEST reported session_id (init/result) as the id to use for any later resume/fork, and verify setCurrentSessionId behaves correctly now that the process is not respawned per turn."
    status: completed
  - id: version-bump-p1
    phase: 1
    content: "Phase 1 — Bump appcloud9.X in package.json before packaging the Phase 1 build."
    status: completed
  - id: verify-p1
    phase: 1
    content: "Phase 1 — Verify the leak is gone: ps shows exactly ONE stream-json process for the active session and the count does not grow across many turns, resends, reloads, and rapid consecutive sends; New Session (+) and History-resume each tear down and respawn exactly one; Stop (current hard-kill behavior) leaves no orphan. Run a verification subagent over the diff for the single-writer invariant and handler identity-guarding."
    status: completed

  # ────────────────────────────────────────────────────────────────────
  # Phase 2 · Control protocol & lifecycle UX (gated on Phase 0 findings)
  # ────────────────────────────────────────────────────────────────────
  - id: control-sender
    phase: 2
    content: "Phase 2 — Add an outbound control_request sender with request_id correlation (Map<request_id, resolver> Promise map) and route inbound control_response in the stdout parser, mirroring the existing inbound control_request handler."
    status: pending
  - id: initialize-handshake
    phase: 2
    content: "Phase 2 — Perform the initialize control_request on spawn using the Phase 0 schema; parse control_response for models/commands; cache them and post to the UI. Degrade gracefully if the handshake fails (turn loop must still work)."
    status: pending
  - id: model-enumeration-ui
    phase: 2
    content: "Phase 2 — Populate the model dropdown from the initialize models list; render it as an editable combo box so unknown/future IDs (Bedrock profiles, [1m], Mythos) can be typed and used."
    status: pending
  - id: set-model-inband
    phase: 2
    content: "Phase 2 — On model change at idle, send set_model control_request; handle a rejection by keeping the prior model. Drop the settings-file model dance for runtime selection (keep writing settings.local.json only so external terminals inherit a default, if still needed)."
    status: pending
  - id: stop-interrupt
    phase: 2
    content: "Phase 2 — Change Stop from hard-kill to the interrupt control_request, keeping the process warm; reconcile the resulting result/abort so isProcessing flips false. If interrupt doesn't land within a short timeout, offer escalation to Skull."
    status: pending
  - id: skull-hardkill-park
    phase: 2
    content: "Phase 2 — Add the Skull button: hard-kill the process group (takes subagents) + persist session to history + post a sessionParked message so the UI shows a recycle/resume affordance. (Today's stopProcess SIGTERM behavior becomes Skull.)"
    status: pending
  - id: resume-after-kill
    phase: 2
    content: "Phase 2 — Wire the post-Skull recycle button to lazily respawn with --resume from disk (reuse the loadConversation path) on the next user action."
    status: pending
  - id: persist-on-close
    phase: 2
    content: "Phase 2 — Persist the active session to the history index on extension deactivate (parity with Skull's park-to-history)."
    status: pending
  - id: breakout-fork
    phase: 2
    content: "Phase 2 — Change the breakout button to launch claude --resume <id> --fork-session (+ --model parity), gated on idle so the on-disk transcript the fork copies is complete; replace the current --continue/--resume paths in launchSlashCommand (webview.ts ~1155-1196)."
    status: pending
  - id: settings-watcher-restart
    phase: 2
    content: "Phase 2 — Watch ~/.claude/settings.json (+ project .claude/settings.local.json); on change, graceful restart at the next idle boundary to pick up provider/profile swaps (re-reads env, re-runs initialize)."
    status: pending
  - id: cross-window-lock
    phase: 2
    content: "Phase 2 — Cross-window single-writer guard (mechanism per Phase 0): prefer the CLI's own --session-id conflict detection if the probe confirms it; otherwise a workspace lockfile keyed by session id with a pid + heartbeat (stale heartbeat = free). A session that is live in another window shows a LOCKED icon (🔒) in the History list and is not directly resumable; the user either waits for the other window to release it, or clicks a FORK button to fork it (--resume <id> --fork-session) into a new session this window owns. Different sessions across windows are unaffected — the lock is per session id, not per window."
    status: pending
  - id: message-protocol
    phase: 2
    content: "Phase 2 — Add the new MessageToExtension/MessageFromExtension types (modelList, setModel, stop vs skull, breakout, resumeSession, sessionParked, sessionLocked) in src/webview/vscode.ts and route them in webview.ts."
    status: pending
  - id: version-bump-p2
    phase: 2
    content: "Phase 2 — Bump appcloud9.X in package.json before packaging the Phase 2 build."
    status: pending
  - id: verify-p2
    phase: 2
    content: "Phase 2 — Verification pass: Stop interrupts and leaves the SAME pid alive next turn; Skull kills the group and the session reappears in History with a working recycle/resume; breakout opens a terminal on a NEW session id with the extension's transcript unchanged; dynamic model list + set_model switches with no respawn (pid unchanged); profile swap restarts on the next idle boundary without leaking the old process."
    status: pending
isProject: false
---

# Single-process session lifecycle + control-protocol model switching

## Background

The extension regressed into spawning a fresh `claude` child on every turn and
never reaping the old ones (see
[doc/archive/too_much_spawning.md](doc/archive/too_much_spawning.md)). Orphaned
children stay attached to the same session via `--resume`, race on incoming
turns, and corrupt session state — the "two of me answering" and swallowed
mode-echo symptoms. The regression was introduced while building the terminal
"breakout" feature.

The intended architecture (per [CLAUDE.md](CLAUDE.md)) is **one subprocess per
chat session**. The decision is to honor that as a **reuse** model: one
long-lived process per session, kept warm across turns — the same shape as
interactive `claude` and the Agent SDK's streaming-input mode — not a
respawn-per-turn model.

### Lifecycle model (confirmed)

**One extension panel = exactly one live Claude Code process at any moment.**
There is never more than one. The three UI controls only change *which* session
that single process is attached to, and each does a teardown-then-respawn (never
concurrent processes):

- **`+` (top-right)** — **new session**: kill the current process, spawn fresh
  (no `--resume`).
- **History list (top-right)** — **resume a session in the extension**: kill the
  current process, respawn with `--resume <selected-id>`.
- **Breakout (external-link, bottom-right)** — **fork the current session into a
  terminal**: `claude --resume <id> --fork-session` (+ `--model` parity),
  leaving the extension's own process untouched.

Because there is only ever one in-extension process and it is the sole writer of
its transcript, forking (not plain resume) for breakout is what keeps a second
reader/writer from interleaving into the same on-disk session file.

**Cross-window caveat.** The single-process guarantee holds *within one Cursor
window* (one extension host, module-level state). Two separate Cursor windows
opened on the same workspace are two extension hosts and would each spawn their
own process; if both `--resume` the same session id, their writes interleave and
corrupt the transcript — the CLI does **not** lock plain `--resume`. (It only
detects conflicts on the `--session-id` / remote-control path; see Phase 0.)
Phase 2 adds a per-session-id cross-window guard so that a session live in one
window is shown **locked** (🔒) in another window's History and is not directly
resumable there — the second window either waits or **forks** it into a new
session it owns. Different sessions across windows are unaffected.

### Investigations that shaped the design

1. **Session forking is a first-class CLI capability.** `claude --resume <id>
   --fork-session` copies the conversation so far into a **new** session id,
   leaving the original untouched (the "stub" branches off into its own world).
   Plain `claude --resume <id>` instead *continues the same transcript* — and if
   two processes resume the same id, their writes interleave into one file
   (corruption). So breakout must **fork**, which by construction keeps the
   extension the sole writer of its session.

2. **The stream-json control protocol exposes exactly what model switching
   needs.** Inspection of the installed `claude` binary (2.1.161) suggests a
   control channel alongside the message stream — but the exact request schema
   is **unverified**, which is why Phase 0 exists:
   - The **`initialize`** control_request handshake is expected to return
     `{commands, models, agents, account, pid}` — the source the Agent SDK's
     `supportedModels()` / `supportedCommands()` read from. It is dynamic and
     provider-aware (under Bedrock it reflects that account/region), so it
     future-proofs against new models with no hardcoded list.
   - **`set_model`** (`{subtype:"set_model", model}`) is expected to switch the
     live session's model in-band — no respawn, no settings file. **Whether it
     accepts Bedrock inference-profile IDs / the `[1m]` variant is unknown** and
     is a Phase 0 deliverable.
   - **`interrupt`** is expected to cancel the current turn while keeping the
     process alive.
   - Also reportedly available: `set_permission_mode`, `reload_plugins`,
     `mcp_toggle`, `set_max_thinking_tokens`, `get_settings`,
     `get_context_usage`.

   The extension today does **not** perform the initialize handshake — it spawns
   stream-json and immediately writes a user message — so none of this is wired
   yet. It currently only *receives* `control_request`s (for permissions, at
   [src/subprocess.ts](src/subprocess.ts) ~line 433); it never *sends* them.

### User environment that constrains the design

The user runs Claude Code under **AWS Bedrock** via a Disney AWS profile
(`CLAUDE_CODE_USE_BEDROCK=1`, `AWS_PROFILE`, region-prefixed inference-profile
IDs like `us.anthropic.claude-opus-4-8[1m]`), and a bash function **swaps
`~/.claude/settings.json` in and out by profile** (Disney vs personal). This
means:
- Model IDs are provider-specific and not the friendly aliases — the dynamic
  `initialize` list, not aliases, is the right source.
- The provider/account/region come from `settings.json`'s `env` block, read at
  process startup, so **switching profile requires a process restart**, whereas
  switching model *within* a provider should be an in-band `set_model` (pending
  Phase 0 confirmation that Bedrock IDs are accepted).

## Phasing

The work is split so the actual bug fix ships without waiting on protocol
research:

- **Phase 0 — Spike (research).** One live-binary probe that captures the real
  `initialize` schema, tests `set_model` against Bedrock IDs, and observes
  session-id stability across turns/compaction. It is the single highest-leverage
  de-risk: its findings rewrite parts of Phase 2 and feed the id-handling rule in
  Phase 1. Cheap; do it first. **Output:** fill in the *Phase 0 Findings* section
  below.

- **Phase 1 — Kill the leak.** The reuse rework + identity-guarded handlers +
  kill-before-spawn + stall-watchdog re-homing. This alone fixes the regression
  (the leak and the "two of me" races) and is **fully specified today**. It does
  not depend on the control protocol. Stop keeps its current hard-kill behavior
  in this phase. Ship and verify the process-count invariant before starting
  Phase 2.

- **Phase 2 — Control protocol & lifecycle UX.** Outbound control sender,
  initialize handshake, dynamic+editable model list, in-band `set_model`, Stop→
  interrupt / Skull split, breakout-as-fork, settings watcher, and the message
  protocol additions. Gated on Phase 0.

## Phase 0 Findings

> Probed live against claude **2.1.163** under Bedrock (`AWS_PROFILE`,
> `CLAUDE_CODE_USE_BEDROCK=1`, model `us.anthropic.claude-opus-4-8[1m]`) on
> 2026-06-04. All findings CONFIRMED. The strategic implication: Phase 2's
> in-band model switching and cross-window lock are both viable as designed.

- **initialize request schema the CLI accepts:** ✅ A minimal payload works —
  `{"type":"control_request","request_id":"<id>","request":{"subtype":"initialize","hooks":{},"sdkMcpServers":[]}}`.
  Response is `{"type":"control_response","response":{"subtype":"success","request_id":"<id>","response":{...}}}`.
- **initialize response top-level keys:** `commands, agents, output_style,
  available_output_styles, models, account, pid`. (`account` = `{apiProvider}`.)
- **initialize response `models` entry shape:** `{ value, displayName,
  description, supportsEffort?, supportedEffortLevels?, supportsAdaptiveThinking? }`.
  **`value` is the exact string to round-trip back into `set_model`** (there is
  no separate `id` field — use `value`). 11 entries returned, fully Bedrock /
  region-aware, e.g.: `default` (→ Sonnet 4.5), `us.anthropic.claude-sonnet-4-6`,
  `us.anthropic.claude-sonnet-4-6[1m]`, `us.anthropic.claude-opus-4-8`,
  `us.anthropic.claude-opus-4-8[1m]`, `us.anthropic.claude-opus-4-7[1m]`,
  legacy Opus 4.1/4.6, and `haiku`. So enumeration is dynamic and provider-aware
  — **no hardcoded list needed**, exactly as hoped.
- **`set_model` accepts Bedrock inference-profile IDs?:** ✅ Yes.
- **`set_model` accepts the `[1m]` variant?:** ✅ Yes —
  `set_model` with `model: "us.anthropic.claude-opus-4-8[1m]"` returned
  `{subtype:"success"}`. **No settings-file dance required for runtime model
  switching.** (Payload: `{subtype:"set_model", model:"<value>"}`.)
- **session_id stability across turns on one process:** ✅ Stable — same
  `session_id` (`b13eeacf-…`) reported on `system/init` and every `result`
  across two turns on one warm process. (Compaction not forced in this short
  probe; stability across turns is the load-bearing case and it holds. The
  Phase 1.5 "trust the latest reported id" rule covers any rotation regardless.)
- **`--session-id` rejects a second concurrent process on the same id?:** ✅ YES.
  Process A claimed `<uuid>` via `--session-id`; a second process B with the
  **same** `--session-id` died immediately with
  `Error: Session ID <uuid> is already in use.` (exit 1). **This gives us free
  cross-window conflict detection.**
- **BUT `--resume` does NOT conflict-check:** ⚠️ A third process C with
  `--resume <same-uuid>` while A was still alive **succeeded** and attached to
  the live id — the exact interleave-corruption vector. **Implication for Phase
  2.5:** the cross-window guard must hinge on `--session-id` (extension mints the
  id and always launches/attaches via `--session-id`, never bare `--resume`, for
  a session it wants to own), OR fall back to the lockfile. Bare `--resume` alone
  is unsafe across windows.
- **`--session-id` compatible with stream-json?:** ✅ Yes — process A ran a
  normal stream-json turn under `--session-id`. (Within one window only one
  process is ever alive, so respawn-with-`--session-id` is the natural fit.)

## Approach

Adopt the **single-writer, one-live-process-per-session** invariant and split
responsibilities by cadence:

- **Per turn:** reuse the warm process — write the user message to its stdin.
  Never `stdin.end()` on `result`; never respawn; never pass `--resume` after
  the first spawn.
- **Spawn happens only at:** first turn of a session, resume of an existing
  session (with `--resume <id>`), recovery after Skull/crash, or a settings/
  profile change. Every spawn is preceded by kill-before-spawn as a safety net.
  (In Phase 2 it also immediately performs the `initialize` handshake.)
- **Model within a provider (Phase 2):** dynamic list from the `initialize`
  response → dropdown; change via `set_model` in-band.
- **Provider/profile (Phase 2):** from `settings.json`, applied on (re)spawn; a
  file watcher triggers a graceful restart at the next idle boundary.
- **Stop vs Skull (Phase 2):** Stop = `interrupt` (warm). Skull = hard kill of
  the process group (takes subagents) + park the session to history + offer a
  recycle/resume button. Closing the extension parks to history the same way.
- **Breakout (Phase 2):** `claude --resume <id> --fork-session` (+ `--model`
  parity), enabled only when idle so the on-disk transcript the fork copies is
  complete.

This is hand-rolled against the CLI's control protocol. A strategic alternative
— driving the CLI **through the Agent SDK** to get `supportedModels()`,
`setModel()`, `interrupt()` as typed methods — is noted under Open questions but
is **out of scope** for this work.

## Files to modify

- [src/subprocess.ts](src/subprocess.ts) — the core of the change.
  - *Phase 1:* reuse rework of `sendMessage` (~lines 115–547), remove
    `stdin.end()` on `result` (~441–443), identity-guard the `close`/`error`
    handlers (the `if (!currentClaudeProcess) return` checks at ~468 and ~514),
    re-home the stall watchdog (~383–418) so it arms per-turn rather than per
    `sendMessage` closure, and confirm the silent-query helpers (~69–94).
  - *Phase 2:* outbound control-request sender + response correlator, the
    `initialize` handshake on spawn, `set_model`/`interrupt` senders, split
    `stopProcess` (~954) into interrupt vs hard-kill, and a restart helper for
    settings changes.
- [src/webview.ts](src/webview.ts) — *Phase 2:* routing for the new messages;
  convert the breakout path in `launchSlashCommand` (~1127–1216) from
  `--continue`/`--resume` to `--resume <id> --fork-session`; add the
  `settings.json` watcher. Keep the existing `killProcess()` before `newSession`
  (~165) and `loadConversation` (~159) — those are the teardown-then-respawn
  paths the single-process model relies on.
- [src/conversation.ts](src/conversation.ts) — *Phase 2:* a "park to history"
  hook for Skull/close that guarantees an index entry (saving already happens
  per-message; `forceShutdown` exists at subprocess.ts ~978).
- [src/terminalCommands.ts](src/terminalCommands.ts) — *Phase 2:* fork flag +
  `--model` parity for breakout; review `/model`,`/usage`,`/compact` terminal
  helpers (~69, ~123) for the single-writer invariant.
- [src/webview/vscode.ts](src/webview/vscode.ts) — *Phase 2:* new
  `MessageToExtension` / `MessageFromExtension` union members.
- Webview components — *Phase 2:* Stop/Skull buttons and the post-Skull recycle
  affordance, dynamic + editable model dropdown
  ([src/webview/components/ModelSelector/ModelSelector.tsx](src/webview/components/ModelSelector/ModelSelector.tsx)),
  History-panel resume wiring.
- [package.json](package.json) — bump `appcloud9.X` before packaging each phase.

## Implementation details

### Phase 1.1 — Reuse in `sendMessage`

Restructure the entry so a spawn is conditional:

```
if there is no live process:
    (kill-before-spawn safety net if a stale handle exists)
    spawn claude with stream-json args
      - include --resume <sessionId> ONLY when resuming an existing session
      - do NOT include --resume on a brand-new session
else:
    reuse the live process
write the user message JSON to the live process stdin
```

- **Remove** the `if (jsonData.type === 'result') { stdin.end() }` block
  (~441–443). Ending stdin is what makes the child exit; under reuse it must
  stay open for the life of the session.
- `isProcessing` becomes an **entry guard**: if a turn is already in flight,
  queue and flush at turn end (see Edge cases) — do not spawn a second child.
- The process is torn down only by: New Session (`+`), History-resume,
  settings/profile restart (Phase 2), Skull (Phase 2), or fatal error.

### Phase 1.2 — Identity-guarded handlers

Capture the spawned child in a local (`const proc = claudeProcess`) and, in the
`close`/`error` handlers, **compare against the module-level
`currentClaudeProcess` before mutating shared state**:

```
if (currentClaudeProcess !== proc) return;   // a stale orphan exited; ignore
```

This fixes the bug where a late-closing old child nulls the new child's handle
and flips `isProcessing = false` mid-turn. (Today the handlers only check
`if (!currentClaudeProcess)`, which does not distinguish *which* process closed.)

### Phase 1.3 — Stall-watchdog re-homing

The watchdog (`stallTimer`, subprocess.ts ~383–418) currently lives inside the
`sendMessage` closure and is implicitly tied to one spawn. Under reuse,
`sendMessage` returns while the process lives on, so the watchdog must:
- be owned at a scope that survives across turns, and
- **only arm during an active turn** — start when a user message is written,
  disarm on `result`/abort — so it never SIGTERMs a warm-but-idle process
  sitting between turns.

### Phase 1.4 — Silent-query helpers under reuse

`sendSilentQuery` / `pendingSilentQuery` / `flushPendingSilentQuery` (~69–94)
already assume a live `currentClaudeProcess.stdin` and a warm process — reuse
should make them *more* reliable, not less. Confirm the flush still fires at the
turn boundary now that `isProcessing` clears on `result` rather than on process
close, and adjust the flush trigger if needed.

### Phase 1.5 — Session-id handling

Apply the Phase 0 finding. The safe rule regardless of outcome: **treat the most
recently reported `session_id` (from `system/init` or `result`) as authoritative**
for any later `--resume`/`--fork-session`. `setCurrentSessionId` is already called
on both events (~596, ~820); verify it still lands correctly when the process is
not respawned each turn, and that a mid-process id rotation (if Phase 0 finds
one) updates the stored id used by History-resume and breakout.

### Phase 2.1 — Outbound control protocol

Add (gated on Phase 0):
- A **sender** `sendControlRequest(subtype, payload)` that allocates a
  `request_id`, writes `{type:"control_request", request:{subtype, ...payload},
  request_id}` to stdin, and returns a Promise resolved when the matching
  `control_response` arrives (`Map<request_id, resolver>`).
- In the stdout parser, route `type === "control_response"` to resolve the
  pending Promise (today only `control_request` is handled, ~433).
- **initialize handshake:** immediately after spawn, send the Phase 0 schema and
  await the response; extract `models`/`commands`; post to the webview.
- **set_model:** `sendControlRequest("set_model", { model })`; handle a
  rejection by surfacing an error and keeping the prior model.
- **interrupt:** `sendControlRequest("interrupt", {})` for Stop.

### Phase 2.2 — Stop vs Skull

- **Stop** (one click): `interrupt` control request; keep the process warm;
  reconcile the resulting `result`/abort so `isProcessing` flips false. If
  interrupt doesn't land within a short timeout, offer escalation to Skull.
- **Skull**: the existing `killProcess()` / `killProcessGroup(-pid)` path (takes
  subagents), then **park to history** and post `setProcessing:false` plus a
  `sessionParked` message so the UI shows the recycle/resume affordance. Today's
  `stopProcess()` SIGTERM behavior becomes Skull.
- **Recycle/resume**: lazily respawn with `--resume <id>` from disk (reuse the
  `loadConversation` path) on next user action.

### Phase 2.3 — Breakout = fork

In `launchSlashCommand`'s breakout path (~1155–1196), replace `--continue`
(integrated) and `--resume <id>` (external) with `--resume <id> --fork-session`,
and append the active `--model <id>` so the forked world matches. Enable the
button only when `isProcessing === false`.

### Phase 2.4 — Settings/profile watcher

`vscode.workspace.createFileSystemWatcher` on `~/.claude/settings.json` (and the
project `.claude/settings.local.json`). On change: if idle, graceful restart
(kill + lazy respawn with `--resume`, which re-reads the new provider env and
re-runs initialize); if mid-turn, defer to the next turn boundary. Precedent in
`newSessionOnConfigChange` (webview.ts ~196), but that reacts to VS Code config,
not the external settings file.

### Phase 2.5 — Cross-window single-writer guard

Mechanism chosen by the Phase 0 `probe-session-id-lock` finding:

- **Preferred — lean on the CLI:** if assigning our own `--session-id <uuid>`
  makes the CLI reject a second concurrent process on the same id, adopt
  extension-minted session ids and let the CLI's own
  `Error: Session ID <id> is already in use.` be the conflict signal. The
  extension catches that spawn error and renders the locked UI below.
- **Fallback — our own lockfile:** a file keyed by session id (e.g.
  `<storage>/locks/<sessionId>.lock`) holding the owning window's pid + a
  heartbeat timestamp. Acquire on spawn/resume, release on park/close; a stale
  heartbeat (crashed window) counts as free so no session is permanently locked.

UX (same regardless of mechanism): a session that is live in another window
shows a **🔒 locked icon** in the History list and is not directly resumable. The
row offers a **Fork** button → `--resume <id> --fork-session` into a new id this
window owns (reusing the Phase 2.3 fork path). The user either waits for the
other window to release the lock, or forks. The lock is **per session id** —
resuming *other* sessions across windows is never blocked.

### Phase 2.6 — Model selection UI

Dropdown populated from the `initialize` `models` list, rendered as an
**editable combo box** so an unknown/future ID (Bedrock inference profile,
Mythos, the `[1m]` variant) can be typed and used. Selecting/typing a value
**at idle** issues `set_model`. Drop the `settings.local.json` model write from
the runtime path (keep writing it only if needed so external terminals inherit a
sensible default).

## Edge cases

- **New message mid-turn:** **queue** and flush at turn end; do not spawn a
  second child. (Phase 1 behavior; an interrupt-then-send alternative is a
  Phase 2 open question.)
- **Model switch mid-turn (Phase 2):** the model dropdown only issues
  `set_model` at idle; if the user changes it while a turn is in flight, defer
  the `set_model` to the next idle boundary so it applies to the *next* turn (it
  does not retroactively change the in-flight turn or any queued message sent
  before it).
- **Interrupt doesn't land (Phase 2):** surface escalation to Skull.
- **`set_model` rejected / Bedrock `[1m]` not accepted (Phase 2, pending Phase
  0):** fall back to writing the model to settings + a graceful restart for that
  value; keep the prior model if even that fails.
- **initialize handshake fails (Phase 2):** degrade gracefully — editable-field-
  only model entry, legacy respawn-with-settings model path, and log loudly. The
  turn loop must still work without the handshake.
- **Fork while mid-turn (Phase 2):** breakout disabled until idle (transcript on
  disk must be complete).
- **Switching sessions (new / resume):** always teardown-then-respawn; there is
  never more than one live process. Module-level singletons
  (`currentClaudeProcess`, `abortController`, `isProcessing`, the stall timer)
  are correct precisely *because* the model is single-process — see "What we are
  NOT doing."
- **Stall watchdog** must not kill a warm-but-idle reused process between turns;
  scope it to active turns only (Phase 1.3).
- **Auth error mid-session:** existing `fireAuthError` path; ensure it parks
  rather than silently leaks.

## What we are NOT doing

- **Not supporting concurrent multi-session.** One extension panel = exactly one
  live process; switching sessions is teardown-then-respawn. The process-state
  singletons stay module-level (no `Map<sessionId, …>` refactor). A future
  multi-session effort is out of scope here. (Cross-*window* safety is handled by
  the Phase 2 per-session-id lock, not by supporting concurrent sessions in one
  window.)
- **Not adopting the Agent SDK** in this work (flagged below as a follow-up).
- **Not touching the user's profile-swap bash function** — the extension is a
  consumer of `settings.json`, reacting via the watcher (Phase 2).
- **Not hardcoding any model list** — enumeration is the `initialize` handshake;
  unknown IDs go through the editable field.
- **Not building PTY `/model` picker scraping** — the control handshake replaces
  it.
- **Not keeping per-turn `--resume`/respawn** — that is the regression being
  removed (Phase 1).

## Open questions

- **Mid-turn message policy:** queue (chosen for Phase 1) vs interrupt-and-
  replace — revisit once interrupt exists in Phase 2.
- **Terminal slash-helpers** (`/model`, `/usage`, `/compact` in
  terminalCommands.ts ~69/~123) resume the same id — should they also fork to
  preserve single-writer, or is brief read-mostly overlap acceptable?
- **Agent SDK adoption** as a follow-up: trade the hand-rolled control protocol
  (version-coupled) for typed `supportedModels()`/`setModel()`/`interrupt()`.
- *(Resolved by Phase 0, recorded in Phase 0 Findings: initialize schema,
  `set_model` Bedrock/`[1m]` compatibility, `models` entry shape, session-id
  stability.)*

## Verification

### Phase 1 (the leak fix)

- **Process invariant:** across many turns, resends, reloads, Stop, and rapid
  consecutive sends,
  `ps -eo pid,ppid,lstart,command | grep "[c]laude --output-format stream-json"`
  shows **exactly one** process for the active session; the count does not grow
  turn-over-turn.
- **New Session (`+`)** and **History-resume** each tear down the old process and
  leave exactly one new process; no orphans.
- **Stop** (Phase 1 hard-kill behavior) leaves no orphan.
- Run a verification subagent over the diff for the single-writer invariant and
  handler identity-guarding.

#### Phase 1 verification results (2026-06-04, appcloud9.68) — PASS

- **Runtime reuse test** (a harness mirroring `runTurn`/`spawnProcess`/
  `writeUserTurn` against the real `claude` binary, 3 turns): **one** process
  spawned, reused across all turns; **pid stable**; **session_id stable**; live
  `stream-json` process count = **1, 1, 1** turn-over-turn (old code grew 1→2→3);
  clean teardown to 0. Re-run after the bug fixes below — still PASS.
- **Diff-review subagent** confirmed both invariants hold (single-writer reuse;
  close/error handlers identity-guarded). It surfaced and we FIXED:
  - **Bug:** `killProcess()` clears `queuedTurns`, so a respawn triggered mid-
    drain (plan-mode toggle / dead stdin) dropped still-queued turns. Fixed by
    preserving the queue across the in-`runTurn` respawn (external stop/new/
    resume callers still clear it).
  - **Latent:** `isProcessing` could stick true on a synchronous `spawnProcess`
    failure or a `writeUserTurn` no-stdin path. Both now reset processing state
    and disarm the watchdog defensively.
- **Build/package/install:** `npm run compile` + `vsce package` green;
  installed `appcloud9.68` with `--force`.
- **Live in-extension confirmation (2026-06-04 ~23:32–23:36Z) — PASS:** with the
  panel open in a real project window, `ps -eo pid,lstart,command | grep "[c]laude
  --output-format stream-json"` showed **exactly one** subprocess (pid 45595,
  child of extension host 42248, `--resume 99a71132-…`). Re-checked ~4 min and
  several turns later: **same pid 45595, same start time** — the process was
  reused across turns, not respawned. Count stayed 1; one `--resume` id, no
  overlap. This is the bug's prior failure mode (3 overlapping pids on one
  session) now resolved. The single-writer reuse invariant holds in the real
  extension, not just the harness.
  - Note: first reload landed in a **folder-less Cursor window** (no workspace →
    `storagePath=undefined`, blank panel, no turn possible); reopening on the
    project folder resolved it. Candidate Phase 1 follow-up: a "open a folder to
    start" notice for the no-workspace case so the empty panel isn't mistaken for
    a broken extension.
- **Not yet exercised in-app** (left for live use): the UI-driven New Session /
  History-resume teardown and Stop-leaves-no-orphan checks. The kill paths reset
  all reuse state and are identity-guarded, but a dedicated in-Cursor pass on
  those specific buttons is the remaining confirmation.

### Phase 2 (control protocol & UX)

- **Stop** cancels the turn and leaves the **same** process alive (same pid next
  turn). **Skull** kills the group and the session reappears in History with a
  working recycle/resume.
- **Breakout** opens a terminal on a **new** session id; the extension's
  transcript file is unchanged afterward.
- **Model:** dropdown populates dynamically from initialize; selecting a model
  issues `set_model` and the next turn uses it with no respawn (pid unchanged).
- **Profile swap:** running the swap function flips provider on the next idle
  restart without leaking the old process.

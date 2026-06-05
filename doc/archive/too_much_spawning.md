# Bug: Extension spawns a new Claude subprocess every turn and never reaps the old ones

## Severity

**Critical — the extension is currently unusable.** Each user turn leaks an idle
Claude subprocess. Multiple live subprocesses end up attached to the same chat
session simultaneously, race to service incoming messages, and corrupt session
state. Observed symptoms: mode-skill echoes silently swallowed, responses
"alternating" as if two agents are answering, concurrent writes to the same
conversation/plan/temp files, and a steadily climbing process count.

## Summary

`src/subprocess.ts` `sendMessage()` **unconditionally** spawns a brand-new
`claude` child process on every call, overwrites the single
`currentClaudeProcess` reference, and never kills the process that reference
previously pointed to. The orphaned subprocess does not exit — it sits idle
(`Ss`) holding the session — so one subprocess leaks per turn.

This directly violates the documented architecture in `CLAUDE.md`:
> "One Claude Code subprocess instance per chat session."

## Evidence (observed live, 2026-06-04)

`ps` for subprocesses resuming the SAME session id (`99a71132-…`), all children
of the same extension host (ppid `74870`), each spawned roughly one-per-turn and
none reaped:

| PID   | Started   | State |
|-------|-----------|-------|
| 78867 | 13:40:02  | Ss (idle) |
| 78954 | 13:40:41  | Ss (idle) |
| 79706 | 13:44:17  | Ss (idle) |
| 80159 | 13:45:00  | Ss (idle) |
| 80598 | 13:48:00  | Ss (idle) |
| 80912 | 13:50:45  | Ss (idle) |

All share identical args:
```
claude --output-format stream-json --input-format stream-json \
  --include-partial-messages --verbose --permission-prompt-tool stdio \
  --resume 99a71132-9654-4194-b9d3-17a3cf6844c5
```
Each has only a few seconds of CPU time (its one turn), then sleeps forever.
Count climbs by ~1 every turn.

## Root cause (in code)

In [src/subprocess.ts](../src/subprocess.ts), `sendMessage()`:

1. **Always spawns** — no check for an existing live process, no reuse:
   ```ts
   // ~line 238
   abortController = new AbortController();
   ...
   // ~line 272 (non-WSL) / ~line 261 (WSL)
   claudeProcess = cp.spawn(executable, args, {
     signal: abortController.signal,
     ...
   });
   ```
2. **Overwrites the only handle** to the prior process without killing it:
   ```ts
   // ~line 282
   currentClaudeProcess = claudeProcess;   // previous process now unreferenced & unreaped
   ```
   The previous `currentClaudeProcess` (and its `abortController`) are discarded.
   Nothing calls `killProcess()` / `abort()` on the outgoing one.

The kill plumbing already exists and is correct (`killProcess()`,
`killProcessGroup()`, `forceShutdown()` near the bottom of the file) — it's just
**never invoked before a respawn**. The `--resume <sessionId>` flag means every
new spawn re-attaches to the same session, so the orphans aren't even on
distinct sessions; they're redundant readers/writers of one session.

## Why this corrupts the session (not just a resource leak)

The CLI is launched with `--input-format stream-json` / `--output-format
stream-json` over the child's stdio. With N live children all resumed onto the
same session id:
- Incoming user turns / control responses can be delivered to (or raced between)
  more than one child.
- Each child reads & writes the same on-disk conversation history and any temp
  files, interleaving updates.
- The extension's single `currentClaudeProcess` only listens to the newest
  child's stdout, so older children's output is orphaned and their stdin is
  never closed — they linger.

This is the mechanism behind the swallowed mode echo and the "two of me
answering" behavior.

## Proposed fix (for the implementing agent)

Primary: make `sendMessage()` enforce single-instance-per-session.

1. **Kill-before-spawn.** At the top of `sendMessage()` (before building args /
   spawning), if `currentClaudeProcess` is set, `await killProcess()` (it already
   aborts the controller, SIGTERMs the group, waits, then SIGKILLs). Only then
   proceed to spawn. This guarantees at most one live child at a time.
   - Alternatively/additionally **reuse** the existing process: since it's a
     persistent `stream-json` stdin pipe, the intended design may be to write the
     next user message to the *existing* child's stdin rather than spawning at
     all. Confirm which model is intended (see Open questions) — reuse is the
     cleaner fit for "one subprocess per session," with kill-before-spawn as the
     safety net for restart/resume/stop paths.

2. **Guard against concurrent spawns.** If `isProcessing` is already true (a turn
   is in flight), don't spawn a second one — either queue the message or reject.
   Today `sendMessage` sets `isProcessing = true` but doesn't check it on entry.

3. **Reap on all exit paths.** Ensure `close`/`error` handlers null out
   `currentClaudeProcess` only for the process that actually exited (guard by
   identity) so a late exit from an old child can't clobber a new one's handle.

Secondary (tracked separately, see auto-memory `project_subprocess_control_ideas`):
- A **"skull" kill-everything button** in the UI for a hard panic-stop of all
  Claude activity.
- **Subprocess/subagent tracking** so runaway processes are visible and
  accountable.

## Files to modify

- [src/subprocess.ts](../src/subprocess.ts) — `sendMessage()` spawn path
  (~lines 236–282): add kill-before-spawn (or reuse) + concurrent-spawn guard;
  harden `close`/`error` handlers to reap by process identity.

## Immediate mitigation (until fixed)

Reload the Cursor window — the extension host restarts and all leaked children
die with it, returning to a single subprocess. Each subsequent turn will leak
again until the code fix lands.

## How to verify the fix

After implementing, in a running session send several turns, then:
```
ps -eo pid,ppid,lstart,command | grep "[c]laude --output-format stream-json"
```
Expect **exactly one** subprocess for the active session at all times — including
after resends, reloads, stop/restart, and rapid consecutive turns. Confirm the
count does not grow turn-over-turn.

## Open questions

- **Reuse vs. respawn:** Is the intended design to keep one long-lived
  `stream-json` subprocess per session and write each new user message to its
  stdin (reuse), or to spawn fresh per turn with `--resume`? The architecture
  note ("one subprocess per session") implies reuse; the current code implies
  respawn. The fix differs accordingly — confirm before implementing.
- **In-flight turn handling:** when a new message arrives while a turn is still
  processing, should it interrupt (kill + respawn), queue, or be rejected?

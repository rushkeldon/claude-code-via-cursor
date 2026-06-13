---
name: Session-scoped modes — per-session mode state so parallel Cursor windows differ
overview: "Multiple Cursor windows open on the SAME project (same pwd, even same branch) must each run an independent mode (plan in one, agent in another) at the same time. Today all windows share one project-global active_modes.md, so they collide. Fix: key mode state by Claude session id (memory/<sessionId>/active_modes.md) and load it each turn via a UserPromptSubmit hook (the static MEMORY.md pointer can't branch on session). State persists across close/reopen and across /clear. A forked terminal session inherits its parent's mode at birth, then diverges independently. Built from scratch from doc/modes_session_scoped_state.md (the superseded design doc); decisions locked with the user."
todos:
  - id: p0-spike
    phase: "Phase 0 — De-risk"
    content: "Spike: write a throwaway UserPromptSubmit hook that echoes session_id + transcript_path from stdin and injects a marker via additionalContext; register in user settings.json; confirm it fires every turn and the text reaches context. GATE: if injection doesn't work, stop and reconsider before Phase 1."
    status: pending
  - id: p1-hook-script
    phase: "Phase 1 — Loader hook"
    content: "Write the loader hook (bash): read session_id + transcript_path from stdin JSON; resolve <dirname(transcript)>/memory/<session_id>/active_modes.md; if it exists emit {additionalContext: <rendered modes>} else emit nothing (modeless default). Degrade silently if jq/file absent — never error a turn."
    status: pending
  - id: p1-gc
    phase: "Phase 1 — Loader hook"
    content: "SessionStart GC: for each memory/<id>/ dir, remove it iff its sibling <proj>/<id>.jsonl transcript no longer exists (lazy orphan cleanup; self-healing; no external delete trigger). source:clear must NOT trigger reset (modes persist across /clear)."
    status: pending
  - id: p1-register
    phase: "Phase 1 — Loader hook"
    content: "Register both hooks in USER settings.json (~/.claude/settings.json) via the update-config skill: UserPromptSubmit (inject every turn, no matcher) + SessionStart (GC sweep). Fresh hooks block (none exists today)."
    status: pending
  - id: p2-skill-storage
    phase: "Phase 2 — Skill rewrite"
    content: "Rewrite the modes skill's 'State file' section: resolve session id from $CLAUDE_CODE_SESSION_ID; read/write memory/<sessionId>/active_modes.md instead of the project-global file. Fall back to the legacy single-file path on surfaces without that env var (Desktop/Cowork), reusing the existing no-auto-memory degradation branch."
    status: pending
  - id: p2-drop-pointer
    phase: "Phase 2 — Skill rewrite"
    content: "Remove the mandatory MEMORY.md pointer requirement from the skill (the hook is now the per-turn loader, and the pointer can't be session-aware). Replace with an 'ensure the loader hook is installed' note. Remove the stale project-global active_modes.md pointer from this project's MEMORY.md."
    status: pending
  - id: p2-migration
    phase: "Phase 2 — Skill rewrite"
    content: "Migration: on the first directive in a session whose memory/<sessionId>/ dir doesn't exist yet, seed it from the legacy project-global active_modes.md if present. Never delete the legacy file (let it age out so any un-migrated window still reads it)."
    status: pending
  - id: p3-fork-lineage
    phase: "Phase 3 — Fork inheritance"
    content: "Fork inherit-at-birth: CCVC's fork passes a lineage card AS the fork's positional prompt (opts.command in buildExternalClaudeCommand/buildIntegratedArgs, src/webview.ts). Card names the parent's active modes, phrased to trigger the modes skill so the child writes its OWN memory/<childId>/active_modes.md on turn one, then diverges freely. Shell-safe (no $/quote/backtick). Empty parent modes -> no positional prompt (plain interactive fork)."
    status: pending
  - id: p3-fork-collision
    phase: "Phase 3 — Fork inheritance"
    content: "Resolve fork-with-slash-command collision: when opts.command is already set (e.g. breakout fork carrying /compact), decide how the lineage card coexists with it. Likely: prepend the mode re-entry then the user's command, or concatenate — pick one, document it."
    status: pending
  - id: p3-fork-card-ui
    phase: "Phase 3 — Fork inheritance"
    content: "FORKED notice card in the PARENT window only (extension UI, not a model turn): bodyless inline tool-header — 'FORKED' in the .tool-info slot (left, category accent); message 'This session is now forked in your terminal' in a .tool-file-link--inline-style span (right-aligned, direction:rtl left-ellipsis truncation, U+200E LRM guard). Reuses the inlineNoBody path in ToolMessage."
    status: pending
  - id: p4-test-parallel
    phase: "Phase 4 — Verify"
    content: "Verify parallel isolation: two Cursor windows, same project + same branch, enter different modes in each; confirm each window's turns honor only its own mode and the two files never race."
    status: pending
  - id: p4-test-durable
    phase: "Phase 4 — Verify"
    content: "Verify durability + compaction + /clear: a session keeps its mode across close/reopen, across a context compaction (hook re-injects every turn), and across /clear (file untouched)."
    status: pending
  - id: p4-test-fork-gc
    phase: "Phase 4 — Verify"
    content: "Verify fork inheritance (child wakes in parent's mode, then changes it without affecting parent) and GC (delete a session from history; confirm its memory/<id>/ dir is swept on the next SessionStart)."
    status: pending
isProject: false
---

# Session-scoped modes — per-session mode state so parallel Cursor windows differ

## Background

**The requirement:** open multiple Cursor windows on the **same project — same
pwd, even the same git branch** — and have each run an **independent mode** at the
same time (plan in one window while implementing in agent in another).

**Why it's broken today:** the modes skill stores active modes in one file in the
auto-memory directory, which is keyed by the **project path**:

```
~/.claude/projects/<encoded-cwd>/memory/active_modes.md
```

Same pwd → same encoded path → **same file**. Two windows read and write the one
file; last-writer-wins; both converge to the same mode. This isn't a tunable — it's
structural. And "same pwd" deliberately rules out every cheaper disambiguator: you
can't key on cwd or branch because they're *identical* across the two windows. **The
only thing that differs between two same-project windows is the Claude session id.**
So the requirement forces session-id-keyed state.

This plan is built from scratch, superseding the earlier design doc
[doc/modes_session_scoped_state.md](modes_session_scoped_state.md) (kept as
reference; its prose is sound, its old todos are stale). Decisions below are locked
with the user.

### Verified runtime facts (this install, re-confirmed at plan time)

- **`$CLAUDE_CODE_SESSION_ID`** is present in the skill's Bash env (a stable UUID)
  and maps 1:1 to the transcript `~/.claude/projects/<encoded-cwd>/<id>.jsonl`,
  which sits beside the `memory/` directory.
- A **`UserPromptSubmit` hook** receives `session_id` **and** `transcript_path` on
  **stdin JSON**, fires on **every** prompt (no matcher), and injects context via
  `{"additionalContext": "..."}` on stdout (exit 0).
- `--fork-session` mints a **new** session id (verified earlier: it rewrites every
  copied transcript line's id; there is no cross-session lineage field), so a fork
  automatically keys to a *different* state dir — independence is free.
- User `~/.claude/settings.json` currently has **no `hooks` key** — the hooks block
  is added fresh, no merge.
- The current `MEMORY.md` still carries the static `active_modes.md` pointer (line
  1) — the session-blind loader this plan replaces.

## Approach

Two mechanism pieces; everything else is a bolt-on.

**1. Storage — per-session directory.** Replace the one project-global
`active_modes.md` with **`memory/<sessionId>/active_modes.md`** — one directory per
session. Each window writes only its own dir → no races, automatic independence.
(A per-session *directory*, not a flat `modes/<id>.md` bucket, so anything else that
ever wants to be per-session has a home, and GC is a clean `rm -rf <sessionId>/`.)
**Absent dir → modeless default.**

**2. Loading — a hook, not the MEMORY.md pointer.** Mode state must reach context
**every turn**, including turns where you typed no `/modes` directive. Today the
static `MEMORY.md` pointer does that — but it's a *fixed path*, session-blind, which
is exactly why all windows collide. The conditional "load `<sessionId>/`'s file if it
exists, else default" **cannot** be evaluated by the static memory mechanism — it
needs to know the session id at load time. Only a **`UserPromptSubmit` hook** does
(it gets `session_id` on stdin). The hook IS the "if subdir exists load it else
default" logic, run per-turn, per-session. It's also compaction-proof: re-injects
from disk every turn, so modes survive context summarization.

**Decisions locked with the user:**
- **Durability:** modes **persist** across close/reopen (the file simply isn't
  deleted — nearly free once the hook exists).
- **`/clear`:** modes **persist** (the per-session dir is untouched by a clear; do
  nothing special — `source: clear` must not trigger GC/reset).
- **Hook scope:** register in **user** `~/.claude/settings.json` (per-session modes
  is general Claude Code behavior the user wants everywhere, not CCVC-only). Tradeoff:
  touches global config rather than traveling with the repo.
- **Fork:** **inherit-at-birth, then diverge** — the fork starts in the parent's mode
  for continuity, then is fully independent. (This is the costliest choice; it keeps
  the lineage-card mechanism and CCVC fork-path changes. Chosen deliberately.)

```
        WRITE (the skill, this session)            READ/INJECT (the hook, every turn)
   ┌──────────────────────────────┐          ┌──────────────────────────────────┐
   │ /modes plan ./doc             │          │ UserPromptSubmit fires            │
   │ skill resolves its id via     │          │ stdin: session_id, transcript_path│
   │   $CLAUDE_CODE_SESSION_ID     │  same    │ resolve <proj>/memory/<sid>/      │
   │ writes:                       │  dir     │   active_modes.md                 │
   │   memory/<sid>/active_modes.md│ ───────▶ │ exists? inject contents : nothing │
   └──────────────────────────────┘          └──────────────────────────────────┘
         ▲ fork: child's 1st turn writes its own <childId>/ from the lineage card
```

## Files to modify

- The modes skill `SKILL.md` (`../skills-anthropic/modes/code/skills/modes/`) —
  rewrite the State-file section to the per-session-dir model; drop the mandatory
  MEMORY.md pointer; add migration + fork-card materialization. (Outside this repo.)
- A new **loader hook script** (bash) — home TBD in p1; reads stdin, resolves the
  per-session file, injects. Plus a SessionStart GC variant.
- `~/.claude/settings.json` — register `UserPromptSubmit` + `SessionStart` hooks (via
  the update-config skill; fresh `hooks` block).
- This project's `memory/MEMORY.md` — remove the stale `active_modes.md` pointer
  (p2-drop-pointer).
- [src/webview.ts](src/webview.ts) — fork lineage card as `opts.command`
  (`buildExternalClaudeCommand` / `buildIntegratedArgs`) + the collision handling.
- [src/webview/components/ToolMessage/ToolMessage.tsx](src/webview/components/ToolMessage/ToolMessage.tsx)
  / [.less](src/webview/components/ToolMessage/ToolMessage.less) — the FORKED notice
  card (bodyless inline variant), parent window only.

## Implementation details

### Loader hook (inject — UserPromptSubmit)

```bash
#!/usr/bin/env bash
read -r payload
sid=$(jq -r '.session_id' <<<"$payload" 2>/dev/null) || exit 0
tpath=$(jq -r '.transcript_path' <<<"$payload" 2>/dev/null) || exit 0
modefile="$(dirname "$tpath")/memory/$sid/active_modes.md"
[ -f "$modefile" ] || exit 0          # no per-session modes -> inject nothing
jq -n --arg c "$(cat "$modefile")" '{additionalContext:$c}'
```

### GC (SessionStart only — NOT on source:clear)

```bash
# source carried on stdin; skip the sweep when clearing (modes persist across /clear).
src=$(jq -r '.source' <<<"$payload" 2>/dev/null)
[ "$src" = "clear" ] && exit 0
proj=$(dirname "$tpath")
for d in "$proj"/memory/*/; do
  id=$(basename "$d")
  [ -f "$proj/$id.jsonl" ] || rm -rf "$d"   # orphan: no live transcript
done
```

### Lineage card (fork positional prompt)

Generated from the parent's active modes at fork time; rides in as `opts.command`:

```
This is a forked Claude Code session (forkedFrom: <parentId>).
Use the modes skill to enter each of these modes:
- plan: ./doc
```

No "reply with confirmation" line — the skill's echo already surfaces the modes.
`forkedFrom` is lineage/debug only (the modes are listed explicitly). Empty parent
modes → no card → plain interactive fork.

### FORKED notice card

Parent window only, extension-emitted (not a model turn). Bodyless inline
tool-header: `FORKED` in `.tool-info`; message `This session is now forked in your
terminal` in a `.tool-file-link--inline`-shaped span (right-aligned, `direction:rtl`
left-truncation, U+200E LRM prefix per the rtl-path-bidi convention). Uses the
`inlineNoBody` path.

## Edge cases

- **jq / file absent** → hook exits 0 injecting nothing; never errors a turn.
- **Surface without `$CLAUDE_CODE_SESSION_ID`** (Desktop/Cowork) → skill falls back
  to the legacy single-file path; no per-session isolation there (no parallel windows
  there either, so fine).
- **First turn of a forked child does something unrelated** → modes aren't live until
  that first turn processes the card. Acceptable; card phrasing nudges it first.
- **`/clear`** → `source: clear` skips GC and leaves the dir; modes persist (locked).
- **Two windows, same session id** → impossible; CCVC's session lock already prevents
  two writers of one transcript, and ids are unique per session.
- **Legacy project-global `active_modes.md`** → never deleted by us; ages out.
  Migration seeds the per-session dir once, then ignores it.

## What we are NOT doing

- **Not** keeping the project-global single file as the live mechanism (replaced;
  retained read-only for migration only).
- **Not** indexing per-session dirs in MEMORY.md (ephemeral state, and the hook is
  the loader now).
- **Not** wiring fork inheritance via env vars into the terminal (the lineage card
  reuses the existing positional-prompt path — no new transport).
- **Not** resetting modes on `/clear` (locked: persist).
- **Not** touching CCVC's auth/compliance posture — local state only.

## Open questions

- **Hook script home** — beside the modes skill (anchor via `$CLAUDE_PLUGIN_ROOT`?)
  or under `~/.claude/hooks/`? Decide in p1; affects nothing downstream.
- **Fork collision exact rule** — prepend-card-then-command vs. concatenate when a
  breakout fork already carries a slash command (p3-fork-collision). Pick during
  implementation against the real `openTerminal` call shape.

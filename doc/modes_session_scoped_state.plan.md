---
name: Session-scoped modes — per-session durable mode state via hooks
overview: Move the modes skill from one project-global active_modes.md to one mode-state file per Claude session, keyed by session id, so multiple Cursor windows on the same project (even the same branch) can run different modes in parallel. State stays durable across sleep/wake of a session, is loaded each turn by a UserPromptSubmit hook (compaction-proof), garbage-collected lazily at SessionStart, and inherited across CCVC forks via a transcript "lineage card" the forked child reads on its first turn.
todos:
  - id: p0-confirm-env
    phase: "Phase 0 — De-risk"
    content: "Phase 0 — confirm runtime facts on the target install: $CLAUDE_CODE_SESSION_ID present in the skill's Bash env; transcript path <proj>/<id>.jsonl; UserPromptSubmit/SessionStart hook stdin carries session_id + transcript_path; additionalContext injection works"
    status: pending
  - id: p0-decide-layout
    phase: "Phase 0 — De-risk"
    content: "Phase 0 — lock the on-disk layout decision: memory/modes/<session_id>.md (one file per session), NOT indexed in MEMORY.md; legacy active_modes.md kept read-only for migration"
    status: pending
  - id: p1-hook-script
    phase: "Phase 1 — Loader hook"
    content: "Phase 1 — write the hook script (bash): reads session_id + transcript_path from stdin JSON, resolves <dirname(transcript)>/memory/modes/<session_id>.md, emits {\"additionalContext\": <rendered active modes>} on stdout exit 0; no file -> emits nothing"
    status: pending
  - id: p1-hook-config
    phase: "Phase 1 — Loader hook"
    content: "Phase 1 — register the hook in settings.json via update-config: UserPromptSubmit (inject every turn) + SessionStart (inject once + GC sweep); confirm UserPromptSubmit has no matcher and fires on every submit"
    status: pending
  - id: p1-gc-sweep
    phase: "Phase 1 — Loader hook"
    content: "Phase 1 — SessionStart GC: for each memory/modes/*.md, delete it iff its sibling <proj>/<id>.jsonl transcript no longer exists (lazy orphan cleanup; self-healing; no external delete trigger)"
    status: pending
  - id: p2-skill-storage
    phase: "Phase 2 — Skill rewrite"
    content: "Phase 2 — rewrite the modes skill 'State file' section: resolve session id from $CLAUDE_CODE_SESSION_ID, read/write memory/modes/<session_id>.md; fall back to legacy single-file behavior on surfaces lacking that env var (Desktop/Cowork) reusing the existing no-auto-memory degradation branch"
    status: pending
  - id: p2-drop-pointer
    phase: "Phase 2 — Skill rewrite"
    content: "Phase 2 — remove the mandatory MEMORY.md pointer requirement from the skill (the hook is now the loader); replace it with an 'ensure the hook is installed' check"
    status: pending
  - id: p2-migration
    phase: "Phase 2 — Skill rewrite"
    content: "Phase 2 — migration: on first directive in a session with no per-session file yet, seed it from legacy active_modes.md if present; never delete the legacy file (let it age out so windows mid-transition still read it)"
    status: pending
  - id: p3-fork-prompt
    phase: "Phase 3 — Fork inheritance"
    content: "Phase 3 — CCVC fork passes the lineage card AS the fork's positional prompt (opts.command in buildExternalClaudeCommand/buildIntegratedArgs). No parent turn, no waiting. Template: forkedFrom: <parentId> + the parent's active modes as a list, phrased to trigger the modes skill. Shell-safe (no $/quote/backtick). Empty modes -> no positional prompt (plain interactive fork)."
    status: pending
  - id: p3-fork-card-ui
    phase: "Phase 3 — Fork inheritance"
    content: "Phase 3 — FORKED notice card in the PARENT window only (extension UI, not the model): bodyless inline tool-header — 'FORKED' in the .tool-info slot (left, category accent), message 'This session is now forked in your terminal' in a .tool-file-link--inline-style span (right-aligned, rtl left-ellipsis truncation, U+200E LRM guard). Reuses the inlineNoBody path."
    status: pending
  - id: p3-child-materialize
    phase: "Phase 3 — Fork inheritance"
    content: "Phase 3 — child behavior: on first turn the model reads the lineage card and writes memory/modes/<child-id>.md from it (skill or inline); thereafter the hook loads it normally. Missing/malformed card -> child starts modeless (graceful)."
    status: pending
  - id: p4-test-parallel
    phase: "Phase 4 — Verify"
    content: "Phase 4 — verify parallel isolation: open two Cursor windows on the same branch, enter different modes in each, confirm each window's turns honor only its own modes and neither file races the other"
    status: pending
  - id: p4-test-durable
    phase: "Phase 4 — Verify"
    content: "Phase 4 — verify durability + compaction: a session keeps its modes across sleep/wake and across a context compaction (UserPromptSubmit re-injects from disk every turn)"
    status: pending
  - id: p4-test-fork-gc
    phase: "Phase 4 — Verify"
    content: "Phase 4 — verify fork inheritance (child wakes in parent's modes) and GC (delete a session from history, confirm its modes file is swept on the next SessionStart)"
    status: pending
isProject: false
---

# Session-scoped modes — per-session durable mode state via hooks

## Background

The modes skill (`../skills-anthropic/modes`) persists active modes to a single
`active_modes.md` inside Claude's per-project auto-memory directory, pointed at by
a line in `MEMORY.md` that the harness loads into context every turn. Because that
file and its pointer are **project-global**, every Cursor window open on the same
project reads the same modes — so two windows on the same branch **cannot** run
different modes (e.g. planning in one window while implementing in another).

The user wants modes to be **per-session**: durable across a session's sleep/wake
(re-open the same chat, you're in the modes you left), but **isolated** between
concurrently open windows. Parallel windows on the same branch working on different
files is an explicit goal.

### Facts established (verified on this install, 2026-06-10)

- **Per-project memory dir** is keyed by the *directory path* of the project
  (`~/.claude/projects/<encoded-path>/memory/`). Two checkouts of the same repo at
  different paths already get independent state; what we lack is per-*session*
  isolation **within** one checkout.
- **`$CLAUDE_CODE_SESSION_ID`** is present in the skill's Bash environment
  (verified: a stable UUID, identical across a fresh login shell) and maps **1:1**
  to the session transcript `~/.claude/projects/<encoded-path>/<id>.jsonl`, which
  sits beside the `memory/` directory.
- **Hooks do NOT receive that env var.** A `UserPromptSubmit` / `SessionStart` hook
  receives `session_id` **and** `transcript_path` on **stdin JSON** instead, and
  injects context via `{"additionalContext": "..."}` on stdout (exit 0).
  `UserPromptSubmit` fires on **every** prompt (no matcher). `SessionStart` carries
  a `source` (`startup|resume|clear|compact`).
- **`--fork-session` rewrites `sessionId`** on every copied transcript line to the
  new id (verified: no transcript contains a foreign session id, and there is **no**
  cross-session lineage field — only within-file `parentUuid` / `isSidechain`). So a
  forked child **cannot** recover its parent id from transcript data; lineage must
  be carried in conversation **content**.

This asymmetry is the spine of the design: the **skill** resolves its session id
from an **env var** (write path), while the **hook** resolves it from **stdin
JSON** (read/inject path). Both land on the same file by different routes.

## Approach

Two mechanism changes, plus a fork-inheritance path.

**1. Storage: one file per session.** Replace the single project-global
`active_modes.md` with `memory/modes/<session_id>.md` — one file per session. This
is what makes parallel windows safe: each window writes **only its own** file, so
there is no read-modify-write race between windows. (An aggregate file keyed by
session id was rejected: two windows entering modes at the same instant would race
on the one file — the very parallelism we want is what would break it.) The
per-session files are **not** indexed in `MEMORY.md` — they are ephemeral session
state, not durable memories.

**2. Loading: a hook, not the MEMORY.md pointer.** A `UserPromptSubmit` hook reads
`session_id` + `transcript_path` from stdin, resolves
`<dirname(transcript_path)>/memory/modes/<session_id>.md`, and injects its rendered
contents as `additionalContext`. Because it fires **every turn**, it is
**compaction-proof** — modes survive context summarization, re-injected from disk
each turn — and it reflects the current file, so a mode entered mid-session is
picked up with no special handling. The hook needs **no** path-encoding trick:
`dirname(transcript_path)` already *is* the project dir.

**3. Cleanup: lazy GC at SessionStart.** Session deletion from history is
out-of-band (no event fires at delete time), so we don't wait for one. A session's
modes file is an orphan exactly when its `<id>.jsonl` transcript is gone. The
`SessionStart` hook sweeps: for each `memory/modes/*.md`, delete it iff the sibling
transcript no longer exists. Self-healing, runs far less often than every prompt,
keeps the per-turn `UserPromptSubmit` path fast.

**4. Fork inheritance: a lineage card as the fork's positional prompt.** CCVC's fork
(`--resume X --fork-session`) opens a **terminal** running a fresh `claude`; the
extension never captures the child's new id, so inheritance can't be wired
extension-side after the fact, and (per the verified `sessionId` rewrite) the child
can't recover its parent from transcript data. But the fork launch **already takes a
positional prompt** (`opts.command`), which becomes the child's opening turn. So
CCVC passes a **lineage card as that positional prompt** — naming the parent id
(`forkedFrom:`) and its active modes, phrased to trigger the modes skill. On the
child's **first turn**, the skill enters those modes and writes
`memory/modes/<child-id>.md`; the hook loads it normally thereafter. No parent turn,
no waiting, no transcript editing. Missing/empty card → child starts modeless
(graceful). This correctly scopes inheritance to CCVC forks; a plain `--resume`
(same id, not a fork) already keeps its own file. A parent-only **FORKED notice
card** marks the event in the origin window.

```
        WRITE path (the skill)                 READ/INJECT path (the hook)
   ┌───────────────────────────┐         ┌─────────────────────────────────┐
   │ /enterMode plan ./doc      │         │ UserPromptSubmit fires (every    │
   │ skill resolves its id via  │         │ turn). stdin JSON gives:         │
   │   $CLAUDE_CODE_SESSION_ID  │         │   session_id, transcript_path    │
   │ writes:                    │         │ hook reads:                      │
   │   memory/modes/<id>.md     │ ──────▶ │   <dirname(transcript)>/memory/  │
   │                            │  same   │   modes/<session_id>.md          │
   │                            │  file   │ emits {"additionalContext": …}   │
   └───────────────────────────┘         └─────────────────────────────────┘
              ▲ fork: child's 1st turn materializes its file from the lineage card
```

## Files to modify

- [doc/modes_session_scoped_state.plan.md](doc/modes_session_scoped_state.plan.md) — this plan.
- `../skills-anthropic/modes/code/skills/modes/SKILL.md` — the modes skill: rewrite the
  "State file" section (per-session path + env-var id resolution), drop the mandatory
  `MEMORY.md` pointer requirement, add the migration + fork-card materialization
  behavior. (Outside this repo — the skill lives in the sibling skills checkout.)
- A new hook script (location TBD in Phase 1 — likely beside the skill or under
  `~/.claude/hooks/`) implementing inject + GC.
- `~/.claude/settings.json` (or project `.claude/settings.json`) — register the
  `UserPromptSubmit` + `SessionStart` hooks. Routes through the **update-config**
  skill (it's the one piece that touches `settings.json`).
- CCVC fork path: [src/webview.ts](src/webview.ts) — set `opts.command` to the
  lineage card in `buildExternalClaudeCommand` (`:1218`) / `buildIntegratedArgs`
  (`:1233`), generated from the parent's active modes at the
  `forkSessionToTerminal` / `launchSlashCommand` call sites. (When `command` is
  already set — a fork *with* a slash command — decide precedence; likely the card
  wins or they concatenate.)
- FORKED notice card: a new bodyless inline variant in
  [ToolMessage.tsx](src/webview/components/ToolMessage/ToolMessage.tsx) /
  [ToolMessage.less](src/webview/components/ToolMessage/ToolMessage.less), pushed to
  the parent webview at fork time (new message type, parent window only).

## Implementation details

### Hook script (inject)

```bash
#!/usr/bin/env bash
# UserPromptSubmit + SessionStart: inject this session's active modes.
read -r payload                       # stdin JSON
sid=$(jq -r '.session_id' <<<"$payload")
tpath=$(jq -r '.transcript_path' <<<"$payload")
proj=$(dirname "$tpath")
modefile="$proj/memory/modes/$sid.md"
[ -f "$modefile" ] || exit 0          # no modes -> inject nothing
modes=$(cat "$modefile")
jq -n --arg c "$modes" '{additionalContext:$c}'
```

### Hook script (GC, SessionStart only)

```bash
# After injecting, sweep orphans: a modes file with no live transcript.
modedir="$proj/memory/modes"
for f in "$modedir"/*.md; do
  [ -e "$f" ] || continue
  id=$(basename "$f" .md)
  [ -f "$proj/$id.jsonl" ] || rm -f "$f"
done
```

### settings.json registration (via update-config)

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "<inject-hook>", "timeout": 30 } ] }
    ],
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "<inject+gc-hook>", "timeout": 30 } ] }
    ]
  }
}
```

### Per-session file format

Same body as today's `active_modes.md` (it's just the mode list), e.g.:

```markdown
# Active modes

- plan: ./doc
```

### Lineage card via the fork's positional prompt

The fork (`--resume <parentId> --fork-session`) **already accepts a positional
prompt** — `opts.command` in both launch paths (`buildExternalClaudeCommand`
`src/webview.ts:1227`, `buildIntegratedArgs` `:1233`). A non-empty positional
prompt becomes the child's **opening turn** while staying interactive (only the
*empty* string makes the CLI one-shot-and-exit). So the lineage card rides in as
that positional prompt — **no parent turn, no waiting for a disk write, no
hand-editing transcripts.** Entirely child-side.

Template (generated from the parent's active modes at fork time):

```
This is a forked Claude Code session (forkedFrom: <parentId>).
Use the modes skill to enter each of these modes:
- plan: ./doc
- sbs
```

Rules for assembling it:

- **`forkedFrom: <parentId>`** is lineage/debug info only — the modes are carried
  explicitly in the list, so the child never reads the parent's file. It is the
  **parent's** id (the only id known at fork time); never a child id, never a
  `$`-expanded var.
- **Mode list** is the parent's active modes, one per line, in the skill's canonical
  render (`plan: ./doc`, `sbs`, `exclude: *.log`, …).
- **No "reply with confirmation" line needed.** The modes skill's echo contract makes
  the active-modes echo *the entire response* to an `/enterMode` — so triggering the
  skill already surfaces the active modes to the user for free. (Multi-mode caveat
  still holds: the skill processes one directive per turn, so the child enters each
  mode in turn; "enter each of these modes" makes that explicit.)
- **Shell-safe**: no `$`, `"`, or backtick (the external path wraps it as
  `"<command>"`); newlines survive both launch paths.
- **Empty parent modes → no positional prompt** at all (the existing
  plain-interactive fork; unchanged).

### FORKED notice card (parent window, extension-only)

A header-only notice card rendered in the **parent** window (where the user clicked
fork) at fork time — a UI affordance, **not** a model turn, and **extension-only**
(no equivalent in terminal/headless). It signals "a fork just spun off" without
polluting either transcript. The child needs no such card — its first-turn modes
echo already confirms inheritance.

Structurally it's a **bodyless inline tool card**, reusing existing machinery in
[ToolMessage.tsx](src/webview/components/ToolMessage/ToolMessage.tsx) /
[ToolMessage.less](src/webview/components/ToolMessage/ToolMessage.less):

- **`FORKED`** sits in the `.tool-info` slot (left edge, `ToolMessage.tsx:115`),
  with the left-edge category-color accent from `ChatMessage accent={category}`.
- **`This session is now forked in your terminal`** rides in a span shaped like
  `.tool-file-link--inline` (`ToolMessage.less:103`): `flex: 1 1 auto`,
  right-aligned, `direction: rtl` + `text-overflow: ellipsis` so the ellipsis
  appears on the **left** — **real truncation** (the `…` shows only when the text
  overflows the panel width, identical to a Read/Edit path), not a literal prefix.
- **U+200E LRM guard**: prefix the message string with `‎` (Left-to-Right Mark, as
  the path links do at `ToolMessage.tsx:133`) so `direction: rtl` doesn't reorder
  bidi-neutral trailing punctuation. See the `reference_rtl_path_bidi` note.
- **No body** → the `inlineNoBody` path (`ToolMessage.tsx:96`): one clean line, no
  chevron, no toggle, no divider.

## Edge cases

- **Surface without `$CLAUDE_CODE_SESSION_ID`** (Desktop/Cowork) → skill falls back
  to legacy single-file behavior; reuse the existing "no auto-memory dir" degradation
  branch. No per-session isolation there, which is fine (no parallel windows there).
- **First turn of a forked child does something unrelated** → modes aren't live until
  that first turn processes the card. Acceptable; the card phrasing nudges
  materialization as step one.
- **Two windows, same session id** → can't happen; CCVC's session lock
  ([src/webview.ts](src/webview.ts) `sessionLock`) already prevents two writers of one
  transcript, and the id is unique per session.
- **Stale legacy `active_modes.md`** → never deleted by us; ages out. Migration seeds
  the per-session file once, then ignores it.
- **`jq` not installed** → hook should degrade silently (inject nothing) rather than
  error the turn; confirm in Phase 1.
- **Compaction** → `source: compact` SessionStart fires; UserPromptSubmit re-injects
  next turn regardless. Modes survive.

## What we are NOT doing

- **Not** keeping the project-global single file as the live mechanism (it's the
  thing being replaced; retained read-only only for migration).
- **Not** using an aggregate all-sessions file (rejected: parallel-window write race).
- **Not** wiring fork inheritance via env vars passed into the forked terminal
  (the card approach is simpler and needs no new transport).
- **Not** indexing per-session mode files in `MEMORY.md` (they're ephemeral, and the
  hook is the loader now).
- **Not** touching CCVC's auth/compliance posture — this is local state only.

## Open questions

- **Hook script home**: ship beside the modes skill, or under `~/.claude/hooks/`?
  (Affects whether `$CLAUDE_PLUGIN_ROOT`/`$CLAUDE_PROJECT_DIR` is the right anchor.)
- **Settings scope**: register the hooks in user `~/.claude/settings.json` (applies
  everywhere) or project `.claude/settings.json` (this project only)? Per-session
  modes are arguably a global behavior → lean user settings.
- **Fork-with-slash-command collision**: when a fork already carries a slash command
  in `opts.command` (e.g. breakout `/compact`), how do the card and the command
  coexist — card wins, command wins, or concatenate? (Phase 3.)
- **Inherit on `/clear`?** SessionStart `source: clear` keeps the same session id but
  resets the conversation — should modes persist (file untouched, so yes by default)
  or reset? Confirm desired behavior.

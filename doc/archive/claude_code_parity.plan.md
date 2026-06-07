---
name: Claude Code parity — gap analysis & roadmap
overview: >
  An enumeration of every place this extension is NOT at parity with the
  `claude` CLI in a terminal — functionality that is missing, or present but
  noticeably different. Organized as phases of parity-closing work. The body is
  the authoritative gap map; each todo is one parity gap to close.
todos:
  - id: phase0-context
    content: "Phase 0 — Prereqs: remove Add menu + Plan button from PromptPane (being reimplemented); confirm CLI version baseline"
    status: pending
  - id: p1-set-permission-mode
    content: "Phase 1 (in-band correctness) — plan toggle via set_permission_mode, not respawn"
    status: pending
  - id: p1-apply-flag-settings
    content: "Phase 1 — effort/thoughts via apply_flag_settings (in-band), not --settings respawn"
    status: pending
  - id: p1-thinking-tokens
    content: "Phase 1 — expose MAX_THINKING_TOKENS via set_max_thinking_tokens"
    status: pending
  - id: p2-at-mentions
    content: "Phase 2 (input parity) — inline @-file autocomplete via file_suggestions control request"
    status: pending
  - id: p2-command-history
    content: "Phase 2 — per-workspace prompt history recall (up/down + reverse search)"
    status: pending
  - id: p2-shell-mode
    content: "Phase 2 — '!' shell-mode prefix (run shell, add output to context)"
    status: pending
  - id: p3-permission-modes
    content: "Phase 3 (modes) — acceptEdits / auto / dontAsk modes + a mode cycler (parity with Shift+Tab)"
    status: pending
  - id: p4-rewind
    content: "Phase 4 (checkpoints) — true /rewind: conversation+code restore via rewind_files; summarize-from-here"
    status: pending
  - id: p5-mcp
    content: "Phase 5 (MCP) — live MCP management UI via mcp_status/mcp_toggle/mcp_reconnect/mcp_set_servers + OAuth (elicitation)"
    status: pending
  - id: p6-skills-plugins
    content: "Phase 6 (extensibility UI) — un-stub Skills/Plugins management; reload_skills/reload_plugins"
    status: pending
  - id: p7-subagents
    content: "Phase 7 (agents) — surface subagents + /agents management; agent-teams awareness"
    status: pending
  - id: p8-hooks-output-memory
    content: "Phase 8 (config surfaces) — hooks viewer, output-style picker, /memory + /init editing"
    status: pending
  - id: p9-session-mgmt
    content: "Phase 9 (sessions) — rename_session, /export, cross-session search, branch/fork parity"
    status: pending
  - id: p10-flags-bg-tasks
    content: "Phase 10 (long tail) — launch flags (--add-dir, --append-system-prompt, budgets), background tasks (Ctrl+B / /tasks)"
    status: pending
isProject: false
---

# Claude Code parity — gap analysis & roadmap

## Goal

The north star ([doc/vision.md](vision.md)) is **complete parity with Claude
Code**: anything you can do in a `claude` terminal, you can do here — ideally
with a better UI. This document enumerates **where we are not there yet**: every
feature that is missing, or present-but-different. It is the gap map; the
frontmatter groups remediation into phases.

## Method / provenance

Cross-referenced three sources (2026-06-06, against CLI **2.1.167**):
1. **Extension audit** — full inventory of our message protocol, control
   requests, spawn args, components, settings.
2. **Claude Code feature surface** — the complete CC feature set from the
   official docs (`code.claude.com/docs`, index `/docs/llms.txt`).
3. **Control-protocol surface** — [doc/ref/control_protocol_surface.md](ref/control_protocol_surface.md),
   the bidirectional `stream-json` control channel (USED vs WIRE vs unused).

**Severity legend:** 🔴 **Missing** (no equivalent) · 🟡 **Different** (works,
but diverges from CC behavior) · 🟢 **At parity** (listed only where worth
confirming). **Surface tag:** (P) prompt/message · (T) interactive-TUI-only ·
(C) config/flag/settings.json — how CC exposes it, which dictates how we'd wrap it.

## Phase 0 — Prerequisite context (not gaps, but scoping notes)

- **Add menu + Plan button are being removed from `PromptPane`.** The user is
  reimplementing both. The "Add" menu (Plugins/Skills/MCP) currently opens
  **stubbed placeholder modals** anyway (see Phase 6). The Plan button currently
  just sets a `planMode` flag that becomes a spawn-time `--permission-mode plan`
  arg (see Phase 1 / Phase 3). Treat both as **green-field** in their phases
  below; do not preserve the current implementations.
- Skills/plugins/MCP *marketplace* management is explicitly **lower priority**
  per the user ("seems a little ambitious at the moment") — Phase 6 captures it
  but it can slip.

---

## Phase 1 — In-band correctness (stop respawning the process)

These aren't "missing features" so much as **we do them the heavy way**. CC
applies them live; we kill + `--resume` respawn, which is slower and risks the
cost/context accounting seams we've already hit this session.

- 🟡 (P/T) **Plan mode toggle.** We set `--permission-mode plan` at spawn, so
  toggling plan forces a **respawn** ([src/subprocess.ts](../src/subprocess.ts)
  `runTurn` `planModeChanged`). CC flips it in-band. **Gap:** use the
  `set_permission_mode { mode }` control request (WIRE, verified live, no
  respawn). Removes the respawn entirely.
- 🟡 (C) **Effort / thoughts changes.** We inject them via spawn-time
  `--settings` and **respawn** when they change (`thinkingChanged`). CC has
  `apply_flag_settings { settings }` to inject settings.json-shaped config live.
  **Gap:** apply effort/thoughts in-band at the idle boundary (same deferral
  pattern as `set_model`).
- 🔴 (C) **`MAX_THINKING_TOKENS` / precise thinking budget.** Not exposed at
  all. CC: `set_max_thinking_tokens { max_thinking_tokens }` (WIRE) or the env
  var. **Gap:** optional numeric budget control (advanced; lower priority than
  effort).
- 🟢 **Model switch** is already in-band (`set_model`). Good reference pattern
  for the above.

> Net: Phase 1 deletes both respawn triggers, leaving only genuine
> process-env changes (provider/region) as launch-only — per the control-surface
> doc's "respawn-trick implication" section.

---

## Phase 2 — Interactive input parity

CC's input box has affordances we partly lack. We own our textarea, so each is a
reimplementation.

- 🟡 (T) **@-file mentions.** CC: type `@`, get live fuzzy file autocomplete.
  We have an `@` button that opens a VS Code **file picker**, plus drag-drop —
  functional but not the inline-autocomplete experience. **Gap:** inline `@`
  dropdown backed by the `file_suggestions { query }` control request (WIRE —
  this is literally the TUI's own autocomplete source).
- 🔴 (T) **Command history recall.** CC: per-working-dir prompt history,
  Up/Down + `Ctrl+R` reverse search. We only save a single draft
  (`saveInputText` / `draftMessage`). **Gap:** persist a prompt history ring and
  wire Up/Down recall (+ optional search). Natural fit with the cross-session
  search idea in [vision.md](vision.md).
- 🔴 (T) **Shell mode (`!` prefix).** CC: `!cmd` runs a shell command directly
  and adds output to context. **Gap:** no equivalent. (Lower priority — Bash
  tool covers most of it, but `!` is a real CC affordance.)
- 🔴 (T/C) **Vim editor mode.** CC has full vim editing in the prompt + a
  `/config` toggle. **Gap:** none; likely **won't-do** (editor-host territory),
  note as a deliberate non-goal.
- 🔴 (T) **Prompt suggestions** (grayed-out next-prompt hints from git history,
  Tab to accept). **Gap:** none. Low priority.
- 🟢 **Image paste/drag, multiline (Shift+Enter), Stop-as-ESC** are at parity.

---

## Phase 3 — Permission modes (full set + cycling)

We expose only two of CC's six permission modes, and one of those is faked at
our layer.

- 🟢 (P) **plan** — present (becomes in-band in Phase 1).
- 🟡 **bypassPermissions ("YOLO").** We implement it at the **extension layer**
  (auto-approve every `can_use_tool`) rather than via the CLI's
  `bypassPermissions` mode — deliberate, so `AskUserQuestion` still routes. Note
  as intentional divergence, not a bug.
- 🔴 **acceptEdits** — auto-approve edits + common fs commands. No equivalent.
- 🔴 **auto** — everything, vetted by CC's background classifier. No equivalent.
- 🔴 **dontAsk** — allow-rules + read-only Bash, deny the rest. No equivalent.
- 🔴 (T) **Mode cycler.** CC cycles `default → acceptEdits → plan → …` via
  **Shift+Tab** with a status-bar indicator. We have a Plan toggle + YOLO toggle,
  no unified cycler. **Gap:** a single mode control (driven by
  `set_permission_mode`) exposing all modes the account supports.

---

## Phase 4 — Checkpoints & rewind

We have a **checkpoint-like** feature, but it diverges from CC's `/rewind` in a
way worth reconciling.

- 🟡 **Code restore.** We snapshot the workspace into a private backup git repo
  before each turn and can `restoreCommit` to any message
  ([src/backupRepo.ts](../src/backupRepo.ts)). That's *our own* mechanism — it
  restores **code only**.
- 🔴 **Conversation restore.** CC's `/rewind` restores **conversation state too**
  (and offers "restore code", "restore conversation", "restore both",
  "summarize from/up-to here"). We can't roll the transcript back. **Gap:** wire
  the `rewind_files { user_message_id }` control request (WIRE) and add
  conversation truncation/summarize options, so our restore matches CC's menu.
- 🟡 **Trigger.** CC: `/rewind`, aliases `/checkpoint` `/undo`, **double-ESC**.
  Ours: a restore affordance on messages. Different UX; fine, but note it.

---

## Phase 5 — MCP management

Backend helpers exist ([src/skillsAndPlugins.ts](../src/skillsAndPlugins.ts)
`loadMCPServers`/`saveMCPServer`/`deleteMCPServer`) and we pass `--mcp-config`
at spawn — but the **UI is a stub** and none of the live MCP control requests
are used.

- 🔴 (T) **`/mcp` panel** — connect, see status, tool counts, toggle, reconnect,
  OAuth. Our `MCPServersList` component renders placeholder text only.
- 🔴 **Live control requests, all unused:** `mcp_status`, `mcp_toggle`,
  `mcp_set_servers`, `mcp_reconnect`, `mcp_call` (WIRE).
- 🔴 **OAuth / structured input.** Inbound `elicitation` (form/url) is
  **unhandled** → an MCP auth flow that elicits will stall. `request_user_dialog`
  also unhandled. **Gap:** answer these (even a minimal dialog) so MCP flows
  don't hang.

---

## Phase 6 — Skills / plugins management UI (lower priority)

Invocation is solved (pass-through). **Management** is stubbed.

- 🟡 **Skills.** Invoking `/skill` works inline (pass-through). But the
  `SkillsMarketplace` modal is a placeholder; `searchSkills`/`saveSkill`/
  `deleteSkill`/`loadSkills` backends exist but the UI doesn't use them. No
  `/skills` token-usage view. No `reload_skills` (WIRE) after install.
- 🔴 **Plugins.** `PluginsMarketplace` modal is a placeholder; `loadPlugins`/
  `installPlugin`/`removePlugin` exist but unwired to UI. No `reload_plugins`.
- 🟢 **First-run install** of `modes` + `plan2cursor` works (FirstRun modal).
- Note: per user, this whole phase is **deferrable**.

---

## Phase 7 — Subagents & agent teams

- 🟡 **Subagents run** (we render `Agent`/`Task` tool_use), but there's **no
  `/agents` management** (create/edit/scope/model/color) and no special
  rendering of subagent progress. `initialize` returns an `agents` list we
  cache but don't surface.
- 🔴 **Agent teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) — lead+teammates,
  shared task list, mailbox. No awareness at all. (Experimental; low priority,
  but a real CC capability.)
- 🔴 **Background subagents** — `Ctrl+B` backgrounding, `Ctrl+X Ctrl+K` kill-all.
  See Phase 10.

---

## Phase 8 — Config surfaces (hooks, output styles, memory)

- 🔴 (C) **Hooks.** Entire surface absent. CC has ~30 hook events configured in
  settings.json and a read-only `/hooks` viewer. We don't surface or configure
  them. (We *could* even register programmatic hooks via `initialize.hooks` +
  answer `hook_callback`.) High-value for the "extension knows everything" goal.
- 🔴 (C/T) **Output styles.** `initialize` returns `output_style` +
  `available_output_styles` (we cache, never surface). CC: Default / Proactive /
  Explanatory / Learning + custom. **Gap:** a picker.
- 🔴 (T) **`/memory` editing & `/init`.** CLAUDE.md is *read* by CC fine, and
  auto-memory works, but we have no in-UI memory editor or project-init flow.
- 🟡 **Statusline.** CC's `/statusline` is terminal chrome; we have our own
  status bar (cost/context/tokens). Effectively **N/A** — note as intentionally
  replaced, not missing.

---

## Phase 9 — Session management

- 🔴 **Rename.** `rename_session { title }` (WIRE) unused; we auto-title but
  can't let the user rename. CC: `/rename`, `Ctrl+R` in picker.
- 🔴 **Export.** No `/export` equivalent (transcript → text file/clipboard).
- 🔴 **Cross-session search.** CC's picker has `/` search across sessions/PRs.
  We list history but can't search it. (Big opportunity — see [vision.md](vision.md)
  "project-scoped memory / cross-session search" frontier.)
- 🟡 **Resume.** We resume by killing the live process and **reloading the
  transcript JSON** into the webview; CC resumes via `--resume`. Functionally
  similar, mechanically different (and we own a separate transcript store from
  CC's `~/.claude/projects/*.jsonl`). Note the divergence.
- 🟡 **Branch/fork.** We fork **to a terminal** (`--fork-session`); CC also has
  in-session `/branch`. Different.

---

## Phase 10 — Long tail (launch flags, background tasks, misc)

- 🔴 **Background tasks.** `Ctrl+B` background / `/tasks` / `background_tasks`
  + `stop_task` control requests (WIRE) all unused. Long bash/subagents can't be
  detached. Task-lifecycle stream events (`task_started`/`task_progress`/
  `task_notification`/`task_updated`) arrive but aren't surfaced.
- 🔴 **Launch flags not exposed:** `--add-dir` (multi-root context),
  `--append-system-prompt` / `--system-prompt-file`, `--max-turns`,
  `--max-budget-usd`, `--fallback-model`, `--strict-mcp-config`,
  `--setting-sources`. The `initialize` request also accepts many of these
  (`appendSystemPrompt`, `planModeInstructions`, `toolAliases`, `title`,
  `agents`, `skills`, `promptSuggestions`) — settable at handshake without flags.
- 🟡 **`get_settings` / `get_session_cost`.** We compute cost ourselves
  (per-turn delta) and never read CC's authoritative `get_session_cost` (WIRE);
  `get_settings` (WIRE) would let us *reflect* effective config rather than
  guess. Reconciling our estimates against these would fix the approximation
  seams discussed this session.
- 🔴 **`/doctor` / `/debug` / `/feedback`** diagnostics — no equivalents
  (mostly TUI; low priority).
- 🟢 **Fast mode** (`/fast`) — not exposed; minor.
- 🟢 **`ultrathink` keyword / `ultracode`** — not surfaced; minor (effort picker
  covers the common case).

---

## Quick parity scorecard

| Area | State |
|---|---|
| Core chat / streaming / tools | 🟢 parity |
| Permissions (`can_use_tool`, AskUserQuestion) | 🟢 parity |
| Model switching | 🟢 in-band parity |
| Effort / thoughts | 🟡 works, respawns (Phase 1) |
| Plan mode | 🟡 works, respawns (Phase 1/3) |
| Slash commands / skills (invoke) | 🟢 pass-through parity |
| Permission modes (full set) | 🔴 2 of 6 (Phase 3) |
| @-mentions / history / shell-mode | 🔴/🟡 (Phase 2) |
| Checkpoints / rewind | 🟡 code-only, no convo restore (Phase 4) |
| MCP management | 🔴 stubbed (Phase 5) |
| Skills / plugins management | 🔴 stubbed (Phase 6) |
| Subagents / agent teams | 🔴 unmanaged (Phase 7) |
| Hooks / output styles / memory edit | 🔴 absent (Phase 8) |
| Session rename / export / search | 🔴 absent (Phase 9) |
| Background tasks / launch flags | 🔴 absent (Phase 10) |

## What we are NOT doing (deliberate non-goals)

- **Vim editor mode** — editor-host territory; out of scope.
- **Prompt suggestions, `/radio`, `/stickers`, voice dictation, fun/cosmetic
  TUI** — not worth reimplementing.
- **Statusline / theme / `/tui` / fullscreen** — we replace this chrome with our
  own UI; "parity" here means "we have our own equivalent," not "mirror the TUI."
- **bypassPermissions as a true CLI mode** — we keep YOLO at the extension layer
  on purpose (preserves AskUserQuestion routing).

## Open questions

- **Authenticated probes still owed.** `apply_flag_settings` effort and
  `thinkingDisplay` were only verified to *land in `effective`* against an
  unauthenticated binary; whether they change live behavior mid-session needs an
  authenticated Opus 4.8 turn (per control-protocol doc). Confirm before
  building Phase 1 on top of them.
- **Phase ordering.** Phases 1–4 are the high-value core (correctness + the
  input/mode/rewind experience a power user feels daily). 5–10 are breadth.
  Worth confirming that ordering matches your priorities before execution.
- **Which TUI-only commands deserve native UI vs. breakout?** `/agents`, `/mcp`,
  `/config`, `/diff`, `/hooks` are pickers/menus — each is a "reimplement in
  webview" decision. The denylist→breakout escape hatch covers them until then.

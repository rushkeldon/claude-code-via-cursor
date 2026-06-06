# Claude Code via Cursor

A Cursor / VS Code extension that wraps the **Claude Code CLI** in a rich, multi-modal chat interface — think Claude Desktop, but driving your local `claude` and living inside your editor.

It routes every prompt through your locally-authenticated Claude Code session, so usage bills against your Claude subscription's interactive bucket — not Cursor's API tokens.

---

## The idea

**A Claude Code power user should never feel out of place here.** The goal is zero friction: everything you can do in the `claude` CLI, you can do here — slash commands, skills, plan mode, model and effort control — except wrapped in a UI that's nicer to live in than a terminal.

Three principles drive the design:

1. **Full Claude Code parity.** Slash commands and skills pass straight through to your Claude Code session (`/compact`, `/context`, `/loop`, `/code-review`, your own custom commands — all of it). No re-implementation, no second-class subset. If `claude` can do it headlessly, you can do it here, inline.

2. **Change models, effort, and thoughts mid-session — without upending anything.** Switch from Opus to Sonnet, dial effort from `high` to `max`, toggle whether you see Claude's thinking — all from the prompt bar, all without losing your conversation or starting over. Your session continues exactly where it was.

3. **First-class Cursor `plan.md` workflow.** The extension is built to make full use of Cursor's plan schema. Pair it with the two recommended skills (**`modes`** and **`plan2cursor`**) and you get a clean plan → review → execute loop where the plan's todo checkboxes update live in Cursor's plans panel as Claude works.

---

## Requirements

- **Cursor** (or VS Code ≥ 1.94) — the extension targets both.
- **Claude Code CLI** (`claude`) installed and authenticated. Run `claude` once in a terminal and log in; the extension reuses that session.
- That's it. No API key required (though you can supply one via settings if you prefer).

---

## Getting started

1. Install the extension (it's a personal build — install the packaged `.vsix`).
2. Open the **Claude Code via Cursor** view from the activity bar, or hit **`Cmd/Ctrl + Shift + C`**.
3. On first launch you'll be offered the two recommended skills and a chance to set your default model — see [First-run setup](#first-run-setup).
4. Type a message and send. Claude works in your actual workspace, with full tool access (reading/writing files, running commands, web search, MCP servers — whatever your Claude Code setup allows).

---

## Features

### Slash commands & skills — full pass-through

Type `/` in the prompt and the input turns **green** to signal a raw pass-through to Claude Code. A palette appears listing every slash command and skill available in your session — sourced directly from Claude Code's own command list, so it's always accurate and always current (skills you install mid-session show up automatically).

Pick one (or just type it), hit Enter, and it runs **inline** — the command's output and any tool calls render right in the chat, exactly as a normal turn would. `/compact`, `/context`, `/usage`, a custom `/deploy`, a skill like `/loop` — all of it works in place.

> **Need a real terminal?** A few commands genuinely want an interactive TTY (the `/login` browser flow, `/resume` picker). For those — or any time you'd rather drop into a live `claude` session — the **breakout button** in the prompt toolbar forks the current session into a terminal, leaving your in-panel conversation untouched.

### In-session model, effort & thoughts controls

Right above the prompt are three controls, and **none of them disrupt your session**:

- **Model selector** — switch between Opus, Sonnet, Haiku (or type any model id). The switch happens in-band — the next turn just uses the new model.
- **Effort picker** — set Claude's thinking depth (`low` → `medium` → `high` → `xhigh` → `max`). Options are filtered to what the selected model actually supports.
- **Thoughts toggle** — show or hide Claude's summarized reasoning. (The model still thinks either way; this only controls whether you see the summary.)

Change any of them whenever you like. Your conversation carries straight through.

### Plan mode & the Cursor `plan.md` workflow

Plan mode constrains Claude to *planning* — producing a `.plan.md` spec instead of editing code. Toggle it with the **Plan** button in the prompt bar.

Paired with the recommended skills, this becomes a complete workflow:

- **`modes`** gives you persistent modes — most importantly `plan`, which keeps Claude writing a Cursor-compatible `*.plan.md` until you're happy with it.
- **`plan2cursor`** sends that plan into Cursor's plans panel and keeps its todo list updated live as Claude implements against it — so the checkboxes tick off in real time while the work lands.

The result is a tight **plan → review → approve → execute** loop, with Cursor's native plan UI tracking progress the whole way.

### Checkpoints & restore

Before every turn, the extension snapshots your workspace into a private backup git repo (separate from your real `.git`). If a turn takes your code somewhere you don't want, you can **restore** to the state right before any message — an undo button for Claude's edits that never touches your actual version control.

### Conversation history

Every session is saved. The **History** panel lets you browse, resume, fork, and delete past conversations. Sessions locked by another editor window are flagged — and you can **fork** them into a fresh copy to work on in parallel without collision.

### Smart turn handling

- **Queue while busy.** Send follow-up messages while Claude is mid-turn; they queue and flush automatically when the turn ends. Peek, reorder, or pull a queued prompt back into the input.
- **Stop vs. hard-kill.** *Stop* interrupts the current turn but keeps the process warm; the 💀 *skull* hard-kills the process and its subagents and parks the session to history.
- **Dropped-turn recovery.** If a turn goes silent without finishing, the extension nudges it back to life once automatically (configurable), with a stall hint and a hard-kill backstop if it's truly wedged.

### Rich chat surface

- **Live streaming** of text and (optionally) Claude's thinking.
- **Tool calls and results** rendered as readable cards — file edits, command output, diffs.
- **Permission prompts** surfaced as native cards: approve or deny each tool use, or flip on **YOLO mode** to auto-approve everything (use with care).
- **Interactive questions** — when Claude asks you to choose between options, you get real buttons, not a text guess.
- **Images** — paste, drag-drop, or attach images into the prompt; drop files to reference them.
- **Syntax-highlighted code blocks** with copy buttons, token/cost display, and a context-usage indicator.

### Skills & plugins marketplaces

Browse and install Claude Code skills and plugins, manage MCP servers, all from the **Add** menu and **Settings** — no dropping to a terminal.

---

## First-run setup

The first time you open the extension it offers to:

- **Install the two recommended skills** (`modes` and `plan2cursor`) from the companion [skills-anthropic](https://github.com/rushkeldon/skills-anthropic) repo, which unlock the plan workflow described above.
- **Set your default model** for the workspace (written to `.claude/settings.local.json`; pre-filled from your global Claude default, so existing users just confirm).

You can skip it and do any of this later from **Settings**. To see the first-run experience again, re-enable it in Settings → First-Run Experience.

---

## Settings

Open **Settings** from the toolbar. Highlights:

- **Model** — the default model for this workspace.
- **Permissions** — manage the per-tool allow list, or toggle YOLO mode.
- **Thinking** — default effort level and whether thoughts are shown (per-session changes from the prompt bar take precedence).
- **Terminal** — choose the integrated terminal or an external app (iTerm2, Windows Terminal, kitty, …) for breakout sessions; customize the launch template and the green pass-through prompt colors.
- **Custom Claude command** — point at a non-default `claude` executable, or pass custom environment variables.
- **WSL** — run Claude through a WSL distro on Windows.
- **Skills** — install/check the recommended skills.

---

## Keyboard

- **`Cmd/Ctrl + Shift + C`** — open the chat view.
- **Enter** — send. **Shift + Enter** — newline.
- **`/`** at the start of the prompt — open the slash-command palette.
- **Esc** (in command mode) — exit back to a normal prompt.

---

## How it works

One long-lived `claude` subprocess per chat session, spoken to over Claude Code's `stream-json` stdio protocol — the same channel the CLI uses internally. Prompts, slash commands, and skills go in as user messages; model switches, plan-mode toggles, context queries, and permission prompts ride the control protocol. The process is kept warm across turns (no respawn per message), so the experience stays snappy and your session state is continuous.

---

*Personal project — not distributed. Built and installed locally as a `.vsix`.*

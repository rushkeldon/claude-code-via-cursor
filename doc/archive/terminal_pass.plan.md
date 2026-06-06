---
name: Slash-command & skill pass-through (retire the breakout escape hatch)
overview: >
  Send typed /commands and skills straight through the existing stream-json
  stdin channel to the warm Claude Code subprocess instead of forking a separate
  terminal. Source the palette from the authoritative initialize handshake
  command list, keep the green prompt styling as a pass-through indicator, and
  reduce the breakout affordance to the single button in the prompt toolbar.
todos:
  - id: expose-init-commands
    content: "Expose the initialize-handshake command list to the webview (getter + commandList post + commands_changed refresh)"
    status: pending
  - id: palette-source-swap
    content: "Switch fetchCommandList to serve from the init command list; drop the slow claude --print model query"
    status: pending
  - id: passthrough-send
    content: "Route typed /commands through subprocess.sendMessage (stream-json stdin) instead of launchSlashCommand breakout"
    status: pending
  - id: green-passthrough-styling
    content: "Reframe terminal-mode green styling as a pass-through indicator; keep it, drop the inline external-launch icon"
    status: pending
  - id: remove-inline-breakout-icon
    content: "Remove the per-command terminal-launch-icon in the textarea; keep only the toolbar breakout button"
    status: pending
  - id: tty-denylist
    content: "Add a small denylist of TTY-only commands that still route to breakout, with a user-facing note"
    status: pending
  - id: verify
    content: "Build, install with --force, and verify /compact, a skill (/loop), and a denylisted command behave correctly"
    status: pending
  - id: version-bump
    content: "Bump appcloud9.X in package.json to the next version before packaging"
    status: pending
isProject: false
---

# Slash-command & skill pass-through (retire the breakout escape hatch)

## Background

The extension currently treats slash commands and skills as something it
**cannot** run itself. When the user types `/` in the prompt, the input flips
into a green "terminal mode" and the only way to actually run the command is the
**breakout**: `launchSlashCommand()` forks the session
(`--resume <id> --fork-session`) into a separate VS Code / external terminal,
where the user continues in a real `claude` TUI. (`/compact` and `/clear` are the
only two exceptions — `INLINE_SAFE_COMMANDS` — that get sent inline today.)

The breakout was an escape hatch built before we understood the full control
surface. It is disruptive: it spawns a second process, leaves the in-panel
session behind, and forces the Claude Code super-user out of the extension UI
they wanted to stay in.

**The premise of this work is now confirmed.** Per the official Agent SDK
documentation ("Slash Commands in the SDK",
<https://code.claude.com/docs/en/agent-sdk/slash-commands>), slash commands are
invoked by **sending them as the text of a normal user message** — there is no
separate control-request subtype for them. The CLI parses a leading `/` at the
start of a message and dispatches the command exactly as the interactive TUI
does; this works identically for built-in commands (`/compact`, `/clear`,
`/context`, `/model`, …) and for skills / custom commands (`/loop`,
`/code-review`, …). The extension already speaks this exact channel — every turn
is written to the warm subprocess's stdin as a `stream-json` user message in
[writeUserTurn](src/subprocess.ts) (`src/subprocess.ts:984`). So the two
`INLINE_SAFE_COMMANDS` aren't special at all; **every** dispatchable command can
take the same path. We just hadn't generalized it.

This matches the control-surface reference
([doc/ref/control_protocol_surface.md](doc/ref/control_protocol_surface.md)):
commands are discovered via the `initialize` response's `commands` array and
invoked over the ordinary user-message channel — not via a control request.

## Approach

Three coordinated changes, plus styling cleanup:

1. **Source the palette from the `initialize` handshake.** `performInitialize()`
   already caches `cachedCommands` (`src/subprocess.ts:873`) from the handshake
   response — an authoritative, fast, free list that the CLI **pre-filters to
   the commands that actually work in this (headless) session**. Today that cache
   is never surfaced; the palette instead runs a slow, model-dependent
   `claude --print "List all your slash commands…"` query
   (`src/subprocess.ts` / `fetchCommandList` at `src/webview.ts:1128`, 60 s
   timeout, JSON-scraping a model response). Replace that source with
   `cachedCommands`, and refresh on the `commands_changed` stream event.

2. **Pass commands through stdin, not the breakout.** Generalize the
   `INLINE_SAFE_COMMANDS` allow-list into "send everything inline by default."
   When the user submits a `/command` from the prompt, route it through
   `subprocess.sendMessage("/command args")` — the same path a normal message
   takes — instead of `launchSlashCommand()`. Because it's just message text,
   plan-mode/thinking/queue semantics all apply for free.

3. **Keep a small TTY denylist + the breakout as a genuine escape hatch.** The
   `initialize` list already excludes commands that need an interactive terminal
   (per the SDK docs, "only commands that work without an interactive terminal
   are dispatchable"; the session's command list reflects this). As defense in
   depth, maintain a short denylist of known TTY-only commands (`/login`,
   `/resume`, `/agents`, …) that route to the breakout instead of inline. See
   **Open questions** for the deeper "can we host a real TTY in-panel?" question.

4. **Styling: green = pass-through, one breakout button.** Keep the green prompt
   treatment, but **reframe** it: green no longer means "you're about to break
   out," it means "this is a raw pass-through to Claude Code." Remove the inline
   `terminal-launch-icon` inside the textarea (`PromptPane.tsx:441-454`) and the
   `isCommandExternal()` active-state plumbing. The **only** breakout affordance
   becomes the existing `breakout-btn` in the prompt toolbar
   (`PromptPane.tsx:494`), available at all times.

## Files to modify

- [src/subprocess.ts](src/subprocess.ts) — add a `getCachedCommands()` getter
  (mirroring `getCachedModels()` at `:901`); post a `commandList` message after
  `performInitialize()` caches the list (alongside `postModelList()` at `:878`);
  handle the `commands_changed` stream event to re-post. Map each `SlashCommand`
  to the webview's `CommandInfo` shape (`{ name, description, type }`), deriving
  `type: 'skill' | 'builtin'` from the handshake entry.
- [src/webview.ts](src/webview.ts) — rewrite `fetchCommandList()`
  (`:1128`) to ask the subprocess for its cached list instead of spawning
  `claude --print`; broaden `launchSlashCommand()` (`:1194`) so the inline path
  is the default and only denylisted commands force the breakout. Keep
  `forkSessionToTerminal()` (History "Fork") untouched.
- [src/webview/components/PromptPane/PromptPane.tsx](src/webview/components/PromptPane/PromptPane.tsx)
  — change `executeTerminalCommand()` to send inline by default; remove the
  inline `terminal-launch-icon` button and `isCommandExternal()`; keep the
  toolbar `breakout-btn`. Rename the local "terminal mode" concept to
  "pass-through mode" for clarity (signal `terminalMode` → `passthroughMode`,
  optional but recommended).
- [src/webview/components/PromptPane/PromptPane.less](src/webview/components/PromptPane/PromptPane.less)
  — keep the green `.terminal-mode` rules (lines ~350-391) but drop the
  `.terminal-launch-icon` rules; rename the class if the signal is renamed.
- [src/webview/state/commands.ts](src/webview/state/commands.ts) — no shape
  change needed; `CommandInfo` already matches. Confirm the `type` union still
  fits the handshake-derived values.

## Implementation details

### 1. Expose the init command list (`subprocess.ts`)

```ts
// near getCachedModels()
export function getCachedCommands(): any[] | undefined {
  return cachedCommands;
}

// inside performInitialize(), after cachedCommands is set + postModelList():
postCommandList();

// new, mirroring postModelList()
export function postCommandList(): void {
  if (!deps) return;
  const list = (cachedCommands ?? []).map(mapCommandForWebview);
  deps.postMessage({ type: 'commandList', data: list });
}
```

`mapCommandForWebview` converts a handshake `SlashCommand` into `CommandInfo`.
The exact `SlashCommand` field names must be confirmed against a live handshake
log (see **Open questions**); expect at least `name`/`description` and some
flag distinguishing skills from built-ins (e.g. an `isSkill` / `source` field).
Default `type: 'builtin'` when the skill marker is absent.

Handle the `commands_changed` event in the stdout stream parser (wherever
`system`/`stream_event` notifications are dispatched) by calling
`postCommandList()` after refreshing `cachedCommands`. (If `commands_changed`
doesn't carry the new list, re-issue `initialize` or `reload_skills` to refresh
— confirm against the binary.)

### 2. Palette source swap (`webview.ts`)

```ts
function fetchCommandList(): void {
  // Serve the authoritative initialize-handshake list. It's free (no model
  // turn), fast, and already filtered to commands that work headlessly.
  const cmds = subprocess.getCachedCommands();
  if (cmds && cmds.length) {
    postMessage({ type: 'commandList', data: cmds.map(mapCommandForWebview) });
    return;
  }
  // No handshake yet (cold panel): the list will arrive via postCommandList()
  // once performInitialize() completes. Optionally post an empty list now.
}
```

Delete the `cp.execFile(claudePath, ['--print', …])` block and the
`cachedCommandList` globalState cache (the handshake list supersedes it). Keep
`mapCommandForWebview` in one place (export from subprocess or duplicate the
small mapper).

### 3. Pass-through send (`PromptPane.tsx`)

```ts
function executeTerminalCommand() {
  const command = (terminalInput.value || textareaRef.current?.value || '').trim();
  if (!command) return;
  const name = command.replace(/^\//, '').split(/\s+/)[0];
  if (TTY_ONLY_COMMANDS.includes(name)) {
    // genuine escape hatch — keep the fork path for interactive-only commands
    post({ type: 'launchSlashCommand', command, forceExternal: true });
  } else {
    // default: raw pass-through over the existing stream-json stdin channel
    post({ type: 'sendMessage', text: command, planMode: planMode.value });
  }
  exitTerminalMode();
}
```

`Enter` in pass-through mode calls this (already wired at
`PromptPane.tsx:150-154`). The toolbar `breakout-btn` (`:494`) keeps its current
`launchSlashCommand` behavior for an explicit, on-demand fork.

`INLINE_SAFE_COMMANDS` is retired (everything is inline-safe except the TTY
denylist), in both `PromptPane.tsx:29` and `webview.ts:1126`.

### 4. Styling (`PromptPane.tsx` + `.less`)

- Remove the `terminal-launch-icon` button block (`PromptPane.tsx:441-454`) and
  the `isCommandExternal()` helper (`:213-216`).
- Keep the green textarea styling; it now signals "raw pass-through to Claude
  Code." Consider updating the placeholder from "Type a slash command…" to
  something like "Slash command — sent straight to Claude Code".
- The toolbar `breakout-btn` stays as-is.

## Edge cases

- **Cold panel (no handshake yet):** palette is briefly empty; `postCommandList()`
  fills it when `performInitialize()` resolves. Acceptable; optionally show a
  subtle "loading commands…" state.
- **Command not in the init list** (user types an unknown/old command): it gets
  sent as message text; the CLI either runs it or surfaces its own "unknown
  command" — same as the TUI. No special handling needed.
- **`commands_changed` after install/skill add:** must re-post so a
  freshly-installed skill (`installRecommendedSkills`) appears without a panel
  reload. Tie into the existing post-install refresh if one exists.
- **Plan mode + command:** a `/command` sent while plan mode is on flows through
  `sendMessage(text, planMode)` like any message; verify nothing prefixes or
  mangles the leading `/`.
- **Queued turns:** if a turn is in flight, a submitted command queues like any
  message (existing `sendMessage` queue logic) — strictly better than today's
  "refuse to fork while busy" warning.
- **`/clear` semantics:** confirm `/clear` over stdin clears the live session's
  context as expected and the extension's transcript view stays coherent (it was
  already in `INLINE_SAFE_COMMANDS`, so this path is exercised today).

## What we are NOT doing

- **Not removing the breakout entirely.** Per the decision, the single toolbar
  breakout button stays as a deliberate escape hatch (and for genuinely TTY-only
  commands). Only the *inline* per-command launch icon and the auto-"you must
  break out" framing go away.
- **Not touching `forkSessionToTerminal()`** (the History panel's "Fork" for a
  session locked by another window) — different feature, leave it.
- **Not building an in-panel TTY** in this plan (see Open questions).
- **Not migrating the `SlashCommandsModal`** hardcoded list
  ([SlashCommands.tsx](src/webview/components/SlashCommands/SlashCommands.tsx))
  in this pass — it's a separate modal with a static list. Could later share the
  init-sourced list, but out of scope here.

## Open questions

1. **TTY back-and-forth in-panel (the user's question).** "Is there no way to
   support full TTY back-and-forth in the extension interface?" Two layers:
   - *Structured interactivity already works inline.* Commands that prompt the
     user via the **control protocol** — `can_use_tool`, `AskUserQuestion`,
     `elicitation`, `request_user_dialog` — are already intercepted and rendered
     as native cards (see `permissions.handleControlRequest`). So a skill that
     asks a question mid-run does NOT need a terminal; it works over the channel
     we already drive. This covers the large majority of "interactive" skills.
   - *Raw character-cell TUIs* (a command that paints its own full-screen ncurses
     UI — e.g. the `/resume` picker, `/login` browser flow) are a different
     beast: they expect a real PTY, not a JSON message stream. The CLI **already
     excludes these from the headless `commands` list**, which is why the
     denylist is belt-and-suspenders. To truly host these in-panel we'd need to
     embed a PTY-backed terminal (e.g. an xterm.js webview wired to a
     `node-pty`/VS Code pseudoterminal running `claude`) — a substantial separate
     feature. **Recommendation:** ship pass-through now; treat in-panel PTY as a
     future enhancement, with the toolbar breakout covering the gap meanwhile.
     Decision needed: is in-panel PTY in scope for a follow-up, or is breakout
     the permanent answer for raw-TUI commands?
2. **Exact `SlashCommand` shape from `initialize`.** Capture a real handshake
   response (log `resp.commands` in `performInitialize`) to confirm the field
   names for `description` and the skill-vs-builtin discriminator before writing
   `mapCommandForWebview`. The control-surface doc lists `commands:
   SlashCommand[]` but doesn't enumerate the member fields.
3. **`commands_changed` payload.** Does the event carry the refreshed list, or
   just signal "refetch"? Determines whether we re-read `cachedCommands`,
   re-`initialize`, or call `reload_skills`. Verify against the live binary.
4. **Denylist contents.** Initial guess: `login`, `logout`, `resume`, `agents`,
   `mcp` (interactive auth flows), `terminal-setup`. Validate which of these even
   appear in the headless `commands` list — any that don't can be dropped from
   the denylist (the list already filters them).

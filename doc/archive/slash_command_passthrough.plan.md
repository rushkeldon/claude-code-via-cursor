---
name: Slash Command Passthrough and External Terminal
overview: >
  Rework the / button into a CLI passthrough: typing or clicking / enters "terminal mode" (green outline),
  shows a filtered autocomplete of available commands/skills, and on Enter launches the user's external
  terminal with `claude --continue <sessionId>` passing the command directly.
todos:
  - id: command-list-query
    content: "At session start, run a headless `claude --print` query to enumerate all slash commands + installed skills; parse into a signal"
    status: pending
  - id: terminal-mode-ux
    content: "When / is typed or clicked, switch prompt to terminal mode: green outline, show autocomplete dropdown, Escape to exit"
    status: pending
  - id: autocomplete-filter
    content: "Filter the command list on each keystroke (prefix match primary, fuzzy secondary); rebuild on backspace"
    status: pending
  - id: external-terminal-settings
    content: "Add terminal preference to settings: 'Use Cursor terminal' checkbox (default on), plus per-OS terminal selector with 'Other' custom template option"
    status: pending
  - id: external-terminal-launcher
    content: "Implement cross-platform terminal launcher that reads the setting and spawns the configured terminal with a command"
    status: pending
  - id: command-execution
    content: "On Enter in terminal mode: launch external terminal (or Cursor integrated if chosen) with `claude --continue <sessionId>` + the typed command"
    status: pending
  - id: re-fetch-on-slash
    content: "Re-query the command list when / is activated (lazy refresh to catch newly installed skills)"
    status: pending
  - id: first-run-skill-install
    content: "First-run dialog that checks for modes and plan2cursor skills, offers to install them via headless `claude plugin marketplace add` + `claude plugin install`"
    status: pending
  - id: settings-skills-section
    content: "Add Skills section to settings modal showing install status of recommended skills with Install button"
    status: pending
  - id: terminal-mode-colors
    content: "Add color picker in settings for terminal mode border and font colors (default: classic green #00ff41); apply as inline styles when terminal mode active"
    status: pending
  - id: external-launch-indicator
    content: "Always-visible launch icon (upper-right of prompt in terminal mode): gray when command is inline-safe, white when external required. Clickable — forces external terminal launch regardless of safe list. Hover state always white."
    status: pending
  - id: inline-safe-list
    content: "Maintain safe-for-inline list (compact, clear); route these directly to subprocess stdin instead of external terminal"
    status: pending
  - id: verify-build
    content: "Build, install, test the full flow: / activation, autocomplete, terminal launch, color settings, skill install"
    status: pending
isProject: false
---

# Slash Command Passthrough and External Terminal

## Background

We want power users to seamlessly jump between our webview UI and Claude Code's native CLI. The `/` button should be a bridge: it shows what's available (commands + skills), lets you type freely with autocomplete, and when you press Enter it executes the command in a real terminal with the current session context.

Additionally, we want a first-run experience that installs recommended skills (`modes` and `plan2cursor` from `https://github.com/rushkeldon/skills-anthropic`).

## Approach

Three connected pieces:

1. **Command discovery** — headless `claude --print` query asks Claude Code to enumerate its slash commands + skills as JSON. Cached in a signal, refreshed on `/` activation.

2. **Terminal mode UX** — when `/` is active, the prompt switches to a distinct visual state (green border), shows an autocomplete dropdown filtered by keystrokes, and sends the command to an external terminal on Enter.

3. **External terminal launcher** — a configurable system that respects the user's terminal choice. Settings expose a per-OS list of known terminals plus a custom template option. The launcher spawns the terminal with the appropriate "run this command" invocation.

## Files to modify

- [src/webview/components/PromptPane/PromptPane.tsx](src/webview/components/PromptPane/PromptPane.tsx) — terminal mode state, green outline, autocomplete integration
- [src/webview/components/PromptPane/PromptPane.less](src/webview/components/PromptPane/PromptPane.less) — terminal mode styles
- New: `src/webview/components/CommandAutocomplete/CommandAutocomplete.tsx` — filtered dropdown
- New: `src/webview/components/CommandAutocomplete/CommandAutocomplete.less` — dropdown styles
- [src/webview/state/commands.ts](src/webview/state/commands.ts) — new state module: command list signal + fetch logic
- [src/terminalCommands.ts](src/terminalCommands.ts) — external terminal launcher
- [src/webview.ts](src/webview.ts) — handle `launchExternalTerminal` message, first-run check, skill install commands
- [src/settings.ts](src/settings.ts) — terminal preference settings
- [package.json](package.json) — new configuration properties for terminal choice
- [src/webview/components/SettingsModal/SettingsModal.tsx](src/webview/components/SettingsModal/SettingsModal.tsx) — terminal settings section + skills section

## Implementation details

### Command list query

At session start, run headlessly:

```typescript
const result = execFileSync('claude', ['--print', 'List all your slash commands and skills. Return ONLY a JSON object: {"commands":[{"name":"compact","description":"..."}],"skills":[{"name":"modes","description":"..."}]}']);
const parsed = JSON.parse(result);
```

Store in `commandList` signal. Re-run on `/` activation (non-blocking — show cached list immediately, update if response differs).

### Terminal mode UX

State: `terminalMode` signal (boolean). When active:
- Prompt textarea gets class `terminal-mode` → colored outline + colored font (both user-configurable, default: classic terminal green)
- CommandAutocomplete dropdown renders above the prompt (positioned absolutely)
- Escape key → exit terminal mode, clear `/` from input
- Enter key → execute (don't send as normal chat message)
- **External launch icon**: always visible in upper-right corner of prompt during terminal mode. Three states:
  - **Gray** — command is inline-safe (will go over JSONL on Enter). Clicking forces external terminal anyway.
  - **White** — command requires external terminal. Clicking launches it (same as Enter).
  - **Hover** — always turns white, signaling it's clickable.
  Acts as both a visual indicator and an override button. User can always force external even for inline-safe commands.

### Terminal mode colors

Two user-configurable colors in settings (both default to classic terminal green `#00ff41`):
- **Border color** — the outline around the prompt in terminal mode
- **Font color** — the text color in the prompt while in terminal mode

Each has a color picker in the settings dialog. Stored as:
```json
"claudeCodeChat.terminal.borderColor": "#00ff41",
"claudeCodeChat.terminal.fontColor": "#00ff41"
```

Applied via inline style overrides when `terminalMode` is active.

### Safe-for-inline list

Commands known to work over the JSONL bridge without needing a terminal:
```typescript
const INLINE_SAFE_COMMANDS = ['compact', 'clear'];
```

When the user types a command in this list, it's sent directly to the subprocess stdin (like `/compact` already works). No terminal launched, no external-launch icon shown. All other commands go through the external terminal path.

### Autocomplete filtering

```typescript
const filtered = computed(() => {
  const input = terminalInput.value.replace('/', '');
  if (!input) return allCommands.value;
  const prefix = allCommands.value.filter(c => c.name.startsWith(input));
  const fuzzy = allCommands.value.filter(c => c.name.includes(input) && !c.name.startsWith(input));
  return [...prefix, ...fuzzy];
});
```

Dropdown items show name + description. Click inserts the command. Arrow keys navigate.

### External terminal settings

New configuration properties in `package.json`:

```json
"claudeCodeChat.terminal.useIntegrated": { "type": "boolean", "default": true },
"claudeCodeChat.terminal.externalApp": { "type": "string", "default": "" },
"claudeCodeChat.terminal.customTemplate": { "type": "string", "default": "" }
```

In settings UI:
- Checkbox: "Use Cursor's integrated terminal" (default on)
- When unchecked, show dropdown of detected terminals for current OS
- "Other" option reveals a text input for custom template with `{{command}}` placeholder

### External terminal launcher

```typescript
const TERMINAL_TEMPLATES: Record<string, string> = {
  'Terminal.app': `osascript -e 'tell app "Terminal" to do script "{{command}}"'`,
  'iTerm2': `osascript -e 'tell app "iTerm2" to tell current window to create tab with default profile command "{{command}}"'`,
  'Windows Terminal': `wt -d . cmd /c "{{command}}"`,
  'PowerShell': `powershell -Command "{{command}}"`,
  'gnome-terminal': `gnome-terminal -- bash -c "{{command}}; exec bash"`,
  'kitty': `kitty -- {{command}}`,
  'alacritty': `alacritty -e {{command}}`,
  'Ghostty': `ghostty -e {{command}}`,
};
```

Launcher reads the setting, picks the template, substitutes `{{command}}` with `claude --continue <sessionId> /<slash-command>`, and spawns via `child_process.exec`.

### Command execution flow

1. User is in terminal mode, has typed `/modes plan doc/`
2. Presses Enter
3. Webview posts `{ type: 'launchSlashCommand', command: 'modes plan doc/' }`
4. Extension host builds full command: `claude --continue <sessionId> "/modes plan doc/"`
5. Launches in configured terminal
6. Webview exits terminal mode, clears input

### First-run skill install

On extension activation, check `globalState.get('firstRunComplete')`. If false:
1. Check if `~/.claude/skills/modes/SKILL.md` and `~/.claude/skills/plan2cursor/SKILL.md` exist (or use `claude plugin list` to check)
2. If missing, post message to webview to show first-run dialog
3. Dialog shows: "This extension works best with these skills installed" + list with Install buttons
4. Install button triggers headless: `claude plugin marketplace add rushkeldon/skills-anthropic` then `claude plugin install modes@skills-anthropic` and `claude plugin install plan2cursor@skills-anthropic`
5. On success, show checkmark. Set `firstRunComplete` flag.

### Settings skills section

In SettingsModal, add a "Skills" section below Permissions:
- List recommended skills (modes, plan2cursor)
- For each: check existence, show ✓ if installed or "Install" button if not
- Install button runs the same headless commands as first-run

## Edge cases

- **`claude --print` query fails**: fall back to hardcoded built-in list (no skills shown)
- **Custom terminal template missing `{{command}}`**: warn user in settings, don't execute
- **External terminal not found**: show error notice, suggest selecting a different terminal
- **Session ID not yet available**: disable terminal mode until session is active
- **User types `/` mid-sentence**: only activate terminal mode if `/` is at position 0
- **First-run on fresh Claude Code install**: `claude plugin` commands might fail if Claude Code isn't fully set up; show helpful error

## What we are NOT doing

- **Capturing terminal output back into webview** — fire and forget for now
- **Running skills inline** — skills that need interactive terminal stay in the terminal
- **Custom slash command creation** — that's a Claude Code feature, not ours
- **Windows testing in this pass** — macOS first, Windows/Linux follow-up

## Open questions

- Should we also support sending slash commands inline to the subprocess (like `/compact` already works)? Some commands like `/compact` and `/clear` don't need a terminal — they work over the JSONL bridge. We could maintain a "safe for inline" list and only launch terminal for the rest.

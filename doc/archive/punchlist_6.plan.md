---
name: Punchlist 6
overview: Three bugs — external terminal launches in wrong directory, permission requests silently hang (no UI), and model picker overrides user's configured model via --model flag instead of managing settings.local.json.
todos:
  - id: terminal-cd-workspace
    content: "Prepend cd to workspace directory in getTerminalLaunchCommand() before the claude command for all external terminal apps"
    status: pending
  - id: permission-message-types
    content: "Add permissionRequest, permissionResponse, updatePermissionStatus message types to MessageFromExtension/MessageToExtension in vscode.ts"
    status: pending
  - id: permission-state-signal
    content: "Create pendingPermissions signal and message listener for permissionRequest events in webview state"
    status: pending
  - id: permission-component
    content: "Create PermissionRequest component with Allow/Deny/Always Allow buttons, modeled on old project's UI"
    status: pending
  - id: permission-response-post
    content: "Wire the component buttons to post permissionResponse back to extension host"
    status: pending
  - id: permission-verify-flow
    content: "Verify end-to-end: disable YOLO, trigger a tool call, see permission prompt appear, approve it, confirm Claude resumes"
    status: pending
  - id: model-remove-flag
    content: "Remove --model CLI flag logic from subprocess.ts; let the CLI read model from its own settings hierarchy"
    status: pending
  - id: model-settings-ui
    content: "Add model input field in Settings section where user enters their desired model ID; extension writes it to .claude/settings.local.json"
    status: pending
  - id: model-first-run
    content: "On first run (no model in settings.local.json), prompt user to configure model — pre-fill from global ~/.claude/settings.json if available"
    status: pending
  - id: model-picker-display
    content: "Model picker status bar reads from settings.local.json and displays what's actually configured, not an internal tier alias"
    status: pending
  - id: model-verify
    content: "Verify: set model in settings UI, confirm settings.local.json updates, start new session, confirm CLI uses the configured model"
    status: pending
isProject: false
---

# Punchlist 6

Three bugs collected from testing the extension outside of YOLO mode and with external terminal settings.

---

## 1. External terminal launches in wrong directory

### Background

When the user sets Terminal to an external app (Terminal.app, iTerm2, Ghostty) and launches a new Claude session or slash command, the terminal opens but Claude starts in the wrong working directory — typically the VS Code process's cwd rather than the workspace folder.

### Root cause

[getTerminalLaunchCommand()](src/webview.ts) (line ~1293) constructs the launch string without any `cd` prefix. The internal subprocess path correctly passes `cwd` to `cp.spawn()`, but the external terminal path builds a command string with no directory context.

Notably, the Windows Terminal path already does this correctly: `wt -d . cmd /c "${escaped}"` — the `-d .` sets the directory.

### Approach

In `getTerminalLaunchCommand()`, accept the workspace directory as a parameter and prepend `cd <dir> && ` to the command string before it's wrapped for each terminal app. The workspace directory is already available at the call site in `launchSlashCommand()` (from `vscode.workspace.workspaceFolders`).

For AppleScript-based terminals (Terminal.app, iTerm2), the `cd` must be part of the script string that gets executed inside the terminal. For direct-invocation terminals (Ghostty, kitty), it goes before the command in the bash -c string.

### Files to modify

- [src/webview.ts](src/webview.ts) — `getTerminalLaunchCommand()` signature and all terminal command strings; `launchSlashCommand()` to pass workspace dir

---

## 2. Permission requests never shown — silent hang

### Background

When not in YOLO mode, the Claude subprocess sends `control_request` messages (type `can_use_tool`) asking for permission to use tools like Bash/grep. The extension host correctly receives these in `src/permissions.ts` and sends a `permissionRequest` message to the webview — but the webview has no component, no state, and no listener to handle it. The result: Claude hangs indefinitely waiting for a response that never comes, with no visual indication to the user.

### What already works

- **Extension host** (`src/permissions.ts`): Fully implemented — detects control_request, parses it, stores pending requests, sends `permissionRequest` message to webview, handles responses, sends `control_response` back to Claude stdin.
- **AskUserQuestion flow**: Fully working end-to-end — has a component, state signal, message listener, and response posting. This is the pattern to follow.
- **Webview message handler** (`src/webview.ts`): Already handles `permissionResponse` and `askUserQuestionResponse` messages from the webview (lines 695-703).

### What's missing

1. **Message type definitions** — `vscode.ts` doesn't include `permissionRequest` in `MessageFromExtension` or `permissionResponse` in `MessageToExtension`
2. **State signal** — No `pendingPermissions` signal to track incoming permission requests
3. **Message listener** — No `on('permissionRequest', ...)` handler in the webview
4. **UI Component** — No `PermissionRequest` component to render the Allow/Deny/Always Allow buttons
5. **Response posting** — No wiring from button clicks back to `post({ type: 'permissionResponse', ... })`

### Approach

Follow the same pattern as `AskUserQuestion`:

1. Add types to `vscode.ts`
2. Create a `pendingPermissions` signal (similar to `pendingQuestions` in AskUserQuestion.tsx)
3. Register an `on('permissionRequest', ...)` listener
4. Build a `PermissionRequest` component showing: tool name, input details (e.g. the bash command), and buttons: Deny / Always Allow `<pattern>` / Allow
5. On button click, post `permissionResponse` with `{ id, approved, alwaysAllow }`
6. Listen for `updatePermissionStatus` to update/dismiss the prompt after resolution

### Reference

The old project's implementation lives in:
- `../claude-code-chat/src/permissions.ts` — same as current (shared code)
- `../claude-code-chat/src/script.ts:4313-4477` — `addPermissionRequestMessage()` renders the UI
- `../claude-code-chat/src/script.ts:4523-4557` — `respondToPermission()` sends response back
- `../claude-code-chat/src/ui-styles.css:91-337` — permission request styling

### Files to modify

- [src/webview/vscode.ts](src/webview/vscode.ts) — add message types
- [src/webview/components/PermissionRequest/PermissionRequest.tsx](src/webview/components/PermissionRequest/PermissionRequest.tsx) — new component
- [src/webview/components/PermissionRequest/PermissionRequest.less](src/webview/components/PermissionRequest/PermissionRequest.less) — styling
- [src/webview/components/App/App.tsx](src/webview/components/App/App.tsx) — mount the component (likely near AskUserQuestion)

---

## 3. Model picker overrides user's configured model

### Background

The user has `"model": "us.anthropic.claude-opus-4-8[1m]"` in their global `~/.claude/settings.json`. When launching Claude from a terminal directly, they get Opus 4.8 with 1M context. But the extension's model picker stores a tier alias (`opus`) in VS Code workspace state and passes `--model opus` to the CLI, which resolves to Opus 4.6.

The root problem: the extension maintains its own parallel model state (workspace state + `--model` flag) that fights with the CLI's settings hierarchy.

### Approach

Stop fighting the CLI. The extension should manage the model by writing to `.claude/settings.local.json` (project-level CLI settings) and never pass `--model` to the subprocess.

**Phase 1 — Stop overriding (immediate fix):**
- Remove the `--model` flag logic from `subprocess.ts` (lines 215-218)
- The CLI will now read from its settings hierarchy: project settings.local.json → global settings.json

**Phase 2 — Settings UI for model:**
- Add a model configuration field in the extension's Settings panel
- User types their desired model ID (e.g. `us.anthropic.claude-opus-4-8[1m]`, `claude-sonnet-4-6`, etc.)
- Extension writes/updates the `"model"` key in `.claude/settings.local.json`
- No hardcoded model list, no discovery mechanism — the user knows what model they want

**Phase 3 — First-run experience:**
- If no `model` key exists in `.claude/settings.local.json`, show a prompt on first session
- Pre-fill from `~/.claude/settings.json` model value if present (so existing users get their global preference by default)
- User confirms or changes, extension writes to settings.local.json

**Phase 4 — Status bar truth:**
- Model picker in status bar reads from `.claude/settings.local.json` and displays the actual configured model string
- Clicking it navigates to the settings section to edit

### Files to modify

- [src/subprocess.ts](src/subprocess.ts) — remove `--model` flag logic (lines 215-218)
- [src/settings.ts](src/settings.ts) — add read/write for `.claude/settings.local.json` model key; remove workspace state model management
- [src/webview.ts](src/webview.ts) — handle new model-settings messages from webview
- [src/webview/components/ModelSelector/ModelSelector.tsx](src/webview/components/ModelSelector/ModelSelector.tsx) — rework to show configured model from settings.local.json; link to settings for changes
- [src/webview/components/Settings/Settings.tsx](src/webview/components/Settings/Settings.tsx) — add model input field

---

## What we are NOT doing

- **AWS/Bedrock model discovery** — would limit the extension to Bedrock users only
- **Hardcoded model list** — freezes data, breaks when new models (e.g. Mythos) ship
- **CLI model enumeration** — no `claude --list-models --json` exists yet
- **Env var overrides** (ANTHROPIC_DEFAULT_*_MODEL) — fragile; settings.local.json is the proper mechanism

## Edge cases

- **settings.local.json doesn't exist yet**: create it with just `{"model": "..."}` (preserve existing keys if file exists)
- **User has no global settings.json model**: first-run prompt shows empty, user must type a value
- **Permission request expires**: if the subprocess dies while a permission prompt is pending, mark it expired in the UI (extension host already handles this via the conversation reload logic)
- **Multiple pending permissions**: queue them vertically like the old project did — each gets its own card

## Open questions

- Should the model settings input validate the string at all (e.g. check it looks like a model ID), or accept anything and let the CLI error?
- Should we keep the tier-based model picker as a quick-switch alongside the settings input, or fully replace it?

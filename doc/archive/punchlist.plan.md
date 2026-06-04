---
name: UI/UX Punchlist
overview: A collection of polish, bug fixes, and small features spanning session management, visual refinements, and interactive improvements.
todos:
  - id: yolo-warning-on-session-start
    content: "Show YOLO mode warning card when a new session starts with YOLO enabled"
    status: completed
  - id: first-run-gate
    content: "Gate first-run experience behind globalState flag + expose settings checkbox to re-trigger"
    status: completed
  - id: ultrathink-rainbow
    content: "Colorize Ultrathink button text with per-letter rainbow gradient when checked"
    status: completed
  - id: model-status-bar
    content: "Show resolved model name in status bar, synced with dropdown and natural-language switches"
    status: completed
  - id: history-modal
    content: "Convert conversation history from inline panel to modal overlay (same pattern as Settings)"
    status: completed
  - id: auto-blur-buttons
    content: "Blur header buttons after mouse click to prevent accidental re-trigger via Enter/Space"
    status: completed
  - id: history-resume-session
    content: "Fix history to actually resume sessions via --continue and isolate per-session message stores"
    status: completed
  - id: clickable-file-paths
    content: "Make absolute file paths clickable (opens in Cursor) anywhere they appear in tool messages"
    status: completed
  - id: copy-buttons-on-tool-cards
    content: "Add copy button to Bash, Read, Write, Edit tool cards — copy the command or file path"
    status: completed
isProject: false
---

# UI/UX Punchlist

## Background

After manual testing of the extension, several polish items, visual improvements, and a significant session-management bug surfaced. This plan collects them into a single batch to address together.

## 1. YOLO mode warning on new session

**Problem:** When the user starts a new session while YOLO mode is enabled, there's no visual reminder that all permissions are being auto-approved.

**Approach:**
- In `newSession()` in [webview.ts](src/webview.ts) (line ~162), after posting `"newSession"` to the webview, check `config.get<boolean>('permissions.yoloMode', false)`.
- If true, post a notice message to the webview using the existing `pushNotice` pattern (same as `sendAndSaveMessage` with type `notice`).
- The webview already renders `NoticeCard` via [NoticeCard.tsx](src/webview/components/NoticeCard/NoticeCard.tsx) — use variant `'warning'`, title "YOLO Mode Active", body "All permissions are being auto-approved."

**Files to modify:**
- [src/webview.ts](src/webview.ts) — add YOLO check in `newSession()`

## 2. First-run experience gate

**Problem:** The first-run check (`checkFirstRun` at line ~252 in webview.ts) currently keys off whether skills are installed. A developer who already has skills installed never sees the first-run experience. It should be gated by a dedicated flag that persists independently.

**Approach:**
- Use `ExtensionContext.globalState` with key `"hasShownFirstRun"` as the runtime source of truth.
- In `checkFirstRun()`, check this flag first. If true, skip entirely.
- After showing the first-run experience, set the flag to true.
- Add a contributed setting in `package.json`: `claudeCodeChat.firstRun.hasShown` (boolean, default true) — the user can uncheck this in VS Code settings to re-trigger.
- On each launch, if the contributed setting is `false`, clear the globalState flag so the experience re-triggers.

**Files to modify:**
- [src/webview.ts](src/webview.ts) — rewrite `checkFirstRun()` logic
- [package.json](package.json) — add `claudeCodeChat.firstRun.hasShown` setting

## 3. Colorize "Ultrathink" button text

**Problem:** The Ultrathink button in the prompt pane is plain text. When active (checked), it should display a rainbow gradient per letter matching Claude Code's terminal styling.

**Approach:**
- In [PromptPane.tsx](src/webview/components/PromptPane/PromptPane.tsx) (line ~407), when `thinkingMode.value` is true, render the word "Ultrathink" as individual `<span>` elements per character, each with an inline color style.
- Color map (approximate from Claude Code terminal):
  ```
  U: #d4735c  l: #d49a52  t: #c4a84e  r: #a8b85a  a: #6ab87a
  T: #52b8a8  h: #5a9ed4  i: #7a7ec8  n: #a864b8  k: #c85aa0
  ```
- When inactive, render as plain text (current behavior).

**Files to modify:**
- [src/webview/components/PromptPane/PromptPane.tsx](src/webview/components/PromptPane/PromptPane.tsx) — conditional rainbow render for "Ultrathink" button text

## 4. Model name in status bar + picker sync

**Problem:** The user doesn't know the exact resolved model (e.g., `claude-opus-4-6-v1`) — only the tier (Opus/Sonnet/Haiku). And if the model changes via natural language in the conversation, the dropdown picker doesn't update.

**Approach:**
- **Status bar:** In [SessionStatus.tsx](src/webview/components/SessionStatus/SessionStatus.tsx), add the resolved model name to the right side of the status bar. Apply `max-width` + `text-overflow: ellipsis` + `overflow: hidden` via CSS.
- **Detecting the model:** The CLI's `system` → `init` event (subprocess.ts line ~592) includes session metadata. Research whether it includes the resolved model ID. If not, parse it from the first `assistant` message's usage metadata. Expose a new signal `resolvedModel` in `state/session.ts`.
- **Picker sync:** The `modelSwitching` / `modelSwitched` messages (ModelSelector.tsx line ~9) already update the picker. If the CLI emits a model-change signal on natural-language switch, route it through the same message. If not, detect from the `result` event's metadata and post `modelSwitched` back to the webview.
- **Research needed:** Inspect what `jsonData` contains in the `system` init and `result` events for model info.

**Files to modify:**
- [src/webview/components/SessionStatus/SessionStatus.tsx](src/webview/components/SessionStatus/SessionStatus.tsx) — render model name
- [src/webview/components/SessionStatus/SessionStatus.less](src/webview/components/SessionStatus/SessionStatus.less) — max-width + ellipsis styles
- [src/webview/state/session.ts](src/webview/state/session.ts) — add `resolvedModel` signal
- [src/subprocess.ts](src/subprocess.ts) — detect and forward model info from CLI output
- [src/webview/components/ModelSelector/ModelSelector.tsx](src/webview/components/ModelSelector/ModelSelector.tsx) — ensure sync with resolved model signal

## 5. History list as modal

**Problem:** The history panel renders inline and blends into the chat background — hard to distinguish from the main content.

**Approach:**
- Refactor [ConversationHistory.tsx](src/webview/components/ConversationHistory/ConversationHistory.tsx) to wrap its content in the existing `<Modal>` component from [Modal.tsx](src/webview/components/Modal/Modal.tsx).
- Title: "Conversation History"
- The existing list markup stays, just wrapped in `<Modal visible={historyVisible.value} onClose={...}>`.
- The list should remain scrollable (Modal body already handles overflow).
- Delete buttons and click-to-load behavior are unchanged.

**Files to modify:**
- [src/webview/components/ConversationHistory/ConversationHistory.tsx](src/webview/components/ConversationHistory/ConversationHistory.tsx) — wrap in `<Modal>`
- [src/webview/components/ConversationHistory/ConversationHistory.less](src/webview/components/ConversationHistory/ConversationHistory.less) — remove old standalone styling, adapt to modal context

## 6. Auto-blur buttons after click

**Problem:** After clicking a header button (settings, history, new chat, YOLO), it retains focus with a yellow outline. Pressing Enter/Space accidentally re-triggers it.

**Approach:**
- In [ButtonBar.tsx](src/webview/components/ButtonBar/ButtonBar.tsx), after each button's onClick handler fires, call `(e.currentTarget as HTMLElement).blur()`.
- Alternatively, add a shared wrapper: `function blurAfter(fn: () => void) { return (e: MouseEvent) => { fn(); (e.currentTarget as HTMLElement).blur(); }; }` and wrap each onClick.
- This preserves keyboard accessibility — `:focus-visible` (from Tab navigation) still shows focus. We only blur on pointer clicks.

**Files to modify:**
- [src/webview/components/ButtonBar/ButtonBar.tsx](src/webview/components/ButtonBar/ButtonBar.tsx) — blur buttons after mouse click

## 7. History: proper session resume + isolation

**Problem:** Clicking a history item loads old messages into the UI but does NOT restart the Claude Code subprocess with `--continue <session-id>`. The CLI stays on whatever session it was previously on, causing context contamination.

**Approach:**
- **Resume:** In `loadConversation()` ([webview.ts](src/webview.ts) line ~158), after loading conversation data, set `conversation.setCurrentSessionId(conversationData.sessionId)`. The next `sendMessage` call already passes `--resume sessionId` (subprocess.ts line ~222), so this should work.
- **Problem:** Currently `loadConversationHistory` sets the conversation state but doesn't update `currentSessionId` from the loaded data. Fix: call `conversation.setCurrentSessionId(conversationData.sessionId)` in `loadConversationHistory` (line ~1413 area).
- **Isolation:** Verify that `newSession()` properly clears the previous conversation state before loading new data. Currently it does (`conversation.newSession()` resets `currentConversation`, `conversationStartTime`, `currentSessionId`). The contamination likely comes from the fact that the CLI subprocess is still running on the old session while new messages display. Fix: kill the current process before loading a different history entry (same as `newSession()` does).
- **Full fix in `loadConversation()`:**
  1. `await subprocess.killProcess()` — stop current CLI session
  2. Load conversation data and display messages
  3. Set `currentSessionId` from loaded data
  4. Next user message will spawn a new CLI process with `--resume <loaded-session-id>`

**Research needed:** Test `--resume` vs `--continue` — verify which flag Claude Code CLI uses for resuming a past session. Currently the code uses `--resume` (subprocess.ts line 222).

**Files to modify:**
- [src/webview.ts](src/webview.ts) — fix `loadConversation()` to kill process and set session ID
- [src/webview.ts](src/webview.ts) — fix `loadConversationHistory()` to set session ID from loaded data

## 8. Clickable file paths in tool messages

**Problem:** Absolute file paths shown in tool cards (Read, Write, Edit, MultiEdit) are plain text. They should be clickable links that open the file in Cursor.

**Approach:**
- Anywhere a tool message displays an absolute path (starts with `/`), render it as a clickable `<span class="file-link">` element.
- This applies to: Read (the `file_path` input), Write/Edit/MultiEdit (the `file_path` input), and Bash (if paths appear in the command string — best effort regex match for absolute paths).
- On click, post `{ type: 'openFile', filePath: '...' }` to the extension host.
- In the extension host's message switch ([webview.ts](src/webview.ts)), handle `'openFile'`:
  ```ts
  case 'openFile':
    const doc = await vscode.workspace.openTextDocument(message.filePath);
    await vscode.window.showTextDocument(doc);
    break;
  ```
- Style with VS Code link color: `color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline;`
- The `ToolUseMessage` component currently receives `toolName` and `content` but not `rawInput`. Need to thread `rawInput` through from `MessagesList.tsx` so it has access to the file path.

**Files to modify:**
- [src/webview/components/ToolMessage/ToolMessage.tsx](src/webview/components/ToolMessage/ToolMessage.tsx) — render file paths as links
- [src/webview/components/ToolMessage/ToolMessage.less](src/webview/components/ToolMessage/ToolMessage.less) — link styling
- [src/webview/components/MessagesList/MessagesList.tsx](src/webview/components/MessagesList/MessagesList.tsx) — pass `rawInput` to ToolUseMessage
- [src/webview.ts](src/webview.ts) — handle `'openFile'` message

## 9. Copy buttons on tool cards

**Problem:** Bash tool cards show the command but have no copy button. Users have to manually select text. This applies broadly — most tool cards should have a quick-copy affordance.

**Approach:**
- Add a copy button (clipboard icon) to the header area of tool cards for: **Bash** (copies the command), **Read** (copies the file path), **Write/Edit/MultiEdit** (copies the file path).
- Do NOT add copy to tool *result* cards (those are expandable content, less useful to copy in full).
- The button should be small, right-aligned in the tool header, styled subtly (appears on hover or always visible — match existing patterns in the codebase).
- On click, use the webview clipboard API: `navigator.clipboard.writeText(text)`. If that fails (webview security), post a `{ type: 'copyToClipboard', text }` message to the extension host and use `vscode.env.clipboard.writeText(text)` there.
- Brief visual feedback on copy: swap icon to a checkmark for ~1.5s, or show a subtle tooltip "Copied!".

**What to copy per tool:**
| Tool | Copied text |
|------|-------------|
| Bash | The command string (from `rawInput.command`) |
| Read | The file path (`rawInput.file_path`) |
| Write | The file path (`rawInput.file_path`) |
| Edit/MultiEdit | The file path (`rawInput.file_path`) |

**Files to modify:**
- [src/webview/components/ToolMessage/ToolMessage.tsx](src/webview/components/ToolMessage/ToolMessage.tsx) — add copy button to tool header
- [src/webview/components/ToolMessage/ToolMessage.less](src/webview/components/ToolMessage/ToolMessage.less) — copy button styling
- [src/webview/components/MessagesList/MessagesList.tsx](src/webview/components/MessagesList/MessagesList.tsx) — pass `rawInput` to ToolUseMessage (shared with item 8)
- [src/webview.ts](src/webview.ts) — handle `'copyToClipboard'` message (fallback)

## Edge cases

- **Item 1 (YOLO warning):** Don't show if loading a past conversation (only on fresh `newSession` or "New Chat" click).
- **Item 2 (First run):** If the contributed setting is deleted by the user resetting settings, default to `true` (don't re-trigger unexpectedly).
- **Item 6 (Auto-blur):** Don't blur if the click came from keyboard (respect `:focus-visible`).
- **Item 7 (Resume):** If `--resume` fails (session too old or corrupted), catch the error and start a fresh session instead. Show a notice: "Could not resume session — started new."
- **Item 8 (File links):** Handle cases where `file_path` might not exist on disk (file was deleted since the Read). Let Cursor handle the error gracefully.
- **Item 9 (Copy buttons):** `navigator.clipboard.writeText` may be blocked in some webview security contexts. Fallback to extension host clipboard API.

## What we are NOT doing

- **Slash menu cold start (12s):** By design — the CLI loads on first invocation. No action needed.
- **ThinkingPane changes:** Working correctly as-is.
- **Keyboard accessibility overhaul:** Checked, seems fine — leave alone for now.
- **Model name exact values:** Will require runtime research; placeholder approach in the plan for now.

## Open questions

- What signal does the Claude Code CLI emit when the model changes via natural language? Need to inspect `system` or `result` events for a model field.
- Does `--resume` have a TTL? How old can a session be before resume fails?
- Should the "Ultrathink" rainbow also apply when the button is hovered (not just when checked)?

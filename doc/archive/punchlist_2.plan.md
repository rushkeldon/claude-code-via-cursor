---
name: Punchlist 2
overview: Four polish items — status bar model name, first-run experience gate, history dialog spacing/naming, and copy button consistency.
todos:
  - id: model-name-status-bar
    content: "Show actual model identifier in status bar instead of 'default'"
    status: pending
  - id: first-run-gate-fix
    content: "Fix first-run experience so it actually triggers, and add Settings checkbox to reset it"
    status: pending
  - id: history-dialog-polish
    content: "Reduce padding in history modal and generate meaningful session titles"
    status: pending
  - id: copy-button-consistency
    content: "Unify copy button styling across tool responses, Claude messages, and user messages"
    status: pending
  - id: skills-installed-check
    content: "Settings skills section should show checkmarks when skills are already installed, not install buttons"
    status: pending
isProject: false
---

# Punchlist 2

## Background

Manual testing surfaced four issues spanning the status bar, first-run onboarding, conversation history UX, and copy-button visual consistency. Several of these were marked complete in `punchlist.plan.md` but are not actually working correctly.

## 1. Status bar model name shows "default"

**Problem:** The status bar's right-justified model name displays the literal string "default" instead of the resolved model identifier (e.g., `claude-opus-4-6-v1`). This is useless — the user wants to know exactly which model they're on.

**Root cause:** In [src/settings.ts:18](src/settings.ts), `selectedModel` is initialized from workspace state with a fallback of `'default'`. The extension host sends this verbatim via `modelSelected` at startup ([src/webview.ts:328](src/webview.ts)). The webview [src/webview/state/session.ts:7](src/webview/state/session.ts) initializes `resolvedModel` to `'opus'` but immediately overwrites it with whatever comes in from `modelSelected` — which is `'default'`.

**Approach:**
- The CLI doesn't currently emit the resolved model name back to us. When `selectedModel` is `'default'` or a tier name (`'opus'`, `'sonnet'`), we need to map it to the actual model ID.
- Option A (preferred): Maintain a hardcoded mapping of tier → current model ID (e.g., `opus` → `claude-opus-4-6-v1`, `sonnet` → `claude-sonnet-4-6-20250514`). Update this map when models change. When `selectedModel === 'default'`, resolve to the opus mapping (since that's the default tier). Display this resolved string in the status bar.
- Option B: Parse the CLI's init/system output for a model field. Research needed — inspect JSON events from the subprocess for any `model` key.
- The status bar already has ellipsis/max-width handling via the `.session-status-model` class in [SessionStatus.less](src/webview/components/SessionStatus/SessionStatus.less), so long snake_case model IDs won't break layout.

**Files to modify:**
- [src/webview/state/session.ts](src/webview/state/session.ts) — add model-name resolution logic
- [src/settings.ts](src/settings.ts) — expose a `getResolvedModelName()` that maps tier → actual model ID
- [src/webview.ts](src/webview.ts) — send resolved model name in `modelSelected` message instead of raw tier

## 2. First-run experience not triggering

**Problem:** The first-run experience never shows. The extension host sends `firstRunPrompt` to the webview ([src/webview.ts:299](src/webview.ts)), but there is no handler for this message type anywhere in the webview code — `grep -r "firstRunPrompt" src/webview/` returns nothing.

**Root cause:** The extension host emits the message correctly, but the webview never registered a listener for it. The `on('firstRunPrompt', ...)` call is completely missing.

**Approach:**
- Add a `firstRunPrompt` message handler in the webview that shows the first-run UI (likely a modal or welcome card with skills installation prompts).
- The data payload already includes `{ modesInstalled, plan2cursorInstalled }` — use this to show install buttons.
- Additionally, there's no way in Settings to clear the flag. Add a "Show First-Run Again" button or checkbox in [SettingsModal.tsx](src/webview/components/SettingsModal/SettingsModal.tsx) that posts a message to the extension host to clear `globalState("hasShownFirstRun")` and set `firstRun.hasShown` to `false`.

**Files to modify:**
- [src/webview/App.tsx](src/webview/App.tsx) or a new `FirstRun` component — register `on('firstRunPrompt', ...)` and render the first-run UI
- [src/webview/components/SettingsModal/SettingsModal.tsx](src/webview/components/SettingsModal/SettingsModal.tsx) — add "Reset First-Run" button
- [src/webview.ts](src/webview.ts) — handle `resetFirstRun` message from webview (clear both `globalState` and contributed setting)

## 3. History dialog — too much padding, bad session names

**Problem A (padding):** The history modal has excessive whitespace. The Modal's body has `padding: 16px 20px` and the conversation list items have `padding: 8px 14px`. Combined with the modal being 700px wide, there's too much air around the content.

**Problem B (session names):** Sessions are named by their first user message, which is often useless ("Use the modes skill to enter Plan mode please", "Okay. Go ahead and use the modes skill..."). Would be much better to have the model generate a short title.

**Approach (padding):**
- Reduce modal body padding for the history modal specifically (don't break Settings). Either: override via `.conversation-list` negative margins, or add a `compact` prop/class to the Modal component for this use case.
- Reduce conversation item padding from `8px 14px` to `6px 10px`.
- Optionally reduce modal width from 700px to 550px for history specifically.

**Approach (session names):**
- When saving a conversation, after a few exchanges (e.g., 3+ messages), ask the model to generate a short title (5-8 words max). This could be a lightweight follow-up prompt or a heuristic that strips common prefixes ("Use the modes skill to...", "Okay...", "Go ahead and...") and truncates.
- Simpler alternative: Use the first *substantive* user message (skip messages that are just mode directives or short acknowledgements). Or use the first Claude response's first sentence as the title.
- Store the generated title in the conversation metadata (the JSON file).

**Files to modify:**
- [src/webview/components/ConversationHistory/ConversationHistory.less](src/webview/components/ConversationHistory/ConversationHistory.less) — reduce padding
- [src/webview/components/Modal/Modal.less](src/webview/components/Modal/Modal.less) — possibly add compact variant or reduce for history
- [src/conversation.ts](src/conversation.ts) — add session title generation logic and storage
- [src/webview.ts](src/webview.ts) — trigger title generation after N messages

## 4. Copy button consistency

**Problem:** Three distinct issues:
1. Tool response copy button (the `⎘` character in `.tool-copy-btn`) is small, uses a text character instead of an SVG, and doesn't match the Claude message copy button styling.
2. User messages have no copy button at all — it was lost when the icon/label header was removed. The `ChatMessage` component only renders the copy button inside the `showHeader && icon && label` conditional, but `UserMessage` passes `icon=""` and `label="You"` which renders the header... actually it should work. Need to verify if the issue is that the user message header was stripped more recently.
3. The ToolResultMessage (green-bordered result cards) similarly lacks a visible copy button.

**Approach:**
- Unify all copy buttons to use the same SVG icon (the one from [ChatMessage.tsx:35](src/webview/components/ChatMessage/ChatMessage.tsx) — a 12x12 clipboard SVG).
- For tool messages: replace the `⎘` text character with the same SVG. Match the `.copy-btn` CSS from ChatMessage.less (hidden until hover, same size, same transition).
- For user messages: if the header is currently hidden, add a standalone copy button that appears on hover in the upper-right corner (position: absolute, right: 8px, top: 8px). This matches the "invisible until hover" requirement.
- For tool result messages: add the same hover-to-reveal copy button.

**Files to modify:**
- [src/webview/components/ToolMessage/ToolMessage.tsx](src/webview/components/ToolMessage/ToolMessage.tsx) — replace `⎘` with SVG copy icon
- [src/webview/components/ToolMessage/ToolMessage.less](src/webview/components/ToolMessage/ToolMessage.less) — update `.tool-copy-btn` to match `.copy-btn` styling
- [src/webview/components/UserMessage/UserMessage.tsx](src/webview/components/UserMessage/UserMessage.tsx) — add hover copy button
- [src/webview/components/ToolResultMessage/ToolResultMessage.tsx](src/webview/components/ToolResultMessage/ToolResultMessage.tsx) — add hover copy button
- [src/webview/components/ChatMessage/ChatMessage.less](src/webview/components/ChatMessage/ChatMessage.less) — possibly extract shared copy-btn styles

## 5. Skills section shows install button even when already installed

**Problem:** In the Settings modal's Skills section ([SettingsModal.tsx:281-326](src/webview/components/SettingsModal/SettingsModal.tsx)), the install/checkmark state is driven by `skillsStatus` signal, which is populated from a `skillsStatus` message from the extension host. The component correctly renders a checkmark when `status.modesInstalled` or `status.plan2cursorInstalled` is true, and an "Install" button otherwise. But in practice, the install button shows even when the skills are physically present on disk.

**Root cause:** The `SkillsSection` component calls `checkStatus()` (which posts `checkSkillsInstalled` to the extension host) on first render when `skillsStatus.value` is null. The extension host presumably checks the filesystem and responds. The bug is likely one of:
1. The extension host handler for `checkSkillsInstalled` isn't correctly checking the current filesystem state (stale cache, wrong path, or race condition).
2. The `skillsStatus` message arrives but `data` doesn't match the expected shape (`{ modesInstalled, plan2cursorInstalled }`).
3. The check runs at startup but the result is never re-sent when Settings opens later.

**Approach:**
- Verify the extension host handler for `checkSkillsInstalled` does a fresh `fs.existsSync()` check on the skill paths (same paths used in `checkFirstRun()` — `~/.claude/skills/modes/SKILL.md` and `~/.claude/skills/plan2cursor/SKILL.md`).
- Ensure the `skillsStatus` message is sent with the correct shape: `{ type: 'skillsStatus', data: { modesInstalled: boolean, plan2cursorInstalled: boolean } }`.
- If the handler is correct but the issue is timing (status arrives before Settings mounts), the `SkillsSection` component already handles this by calling `checkStatus()` when `skillsStatus.value` is null — so this should self-heal. Add logging to trace the actual values.
- Also ensure that after `installRecommendedSkills` completes, a fresh `skillsStatus` message is sent to update the UI immediately.

**Files to modify:**
- [src/webview.ts](src/webview.ts) — verify/fix `checkSkillsInstalled` handler to do fresh filesystem checks
- [src/webview/components/SettingsModal/SettingsModal.tsx](src/webview/components/SettingsModal/SettingsModal.tsx) — verify signal shape handling (likely no change needed if host is fixed)

## Edge cases

- **Item 1 (model name):** If a custom model is selected via env vars (`ANTHROPIC_DEFAULT_OPUS_MODEL`), display that value directly — it's already the full model ID.
- **Item 2 (first-run):** If the `firstRunPrompt` message arrives before the webview is fully mounted, buffer it. Race condition between extension host `checkFirstRun()` and webview hydration.
- **Item 3 (history titles):** Don't block conversation save on title generation — generate async and update the file later. Fallback to truncated first message if generation fails.
- **Item 4 (copy):** The user message copy button must copy the raw markdown/text content, not the rendered HTML.
- **Item 5 (skills status):** If the skills were installed outside the extension (manually via CLI), the extension won't know until the next `checkSkillsInstalled` call. The check-on-mount approach handles this, but a full app restart could show stale state if cached.

## What we are NOT doing

- **Model name from CLI introspection:** The CLI subprocess doesn't reliably emit the resolved model name back. We'll use a local mapping for now rather than parsing subprocess output.
- **AI-generated session titles in real-time:** This could use tokens and add latency. Start with a heuristic approach (skip directive-like prefixes, use first substantive message) and consider model-generated titles as a follow-up.
- **Complete Modal component redesign:** Just tightening padding for this use case, not rethinking the Modal abstraction.

## Open questions

- Does the Claude Code CLI emit the resolved model ID in any JSON event (system init, result metadata)? If so, Option B for item 1 would be preferable.
- Should the "Reset First-Run" control be a button (one-shot action) or a checkbox (mirrors the contributed setting)?
- For session titles: should we spend tokens on a model call, or just use heuristics for now?

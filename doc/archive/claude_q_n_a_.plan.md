---
name: Claude Q & A Card — UI Tweaks
overview: Polish the AskUserQuestion ("CLAUDE Q & A") card — suppress the redundant tool card above it, restyle Submit to match the Stop button with the user-green gradient, and add a non-destructive white Cancel button that declines the question.
todos:
  - id: suppress-tool-card
    content: "Suppress the vestigial AskUserQuestion tool card so only the CLAUDE Q & A panel shows"
    status: pending
  - id: submit-restyle
    content: "Restyle Submit to match the Stop button's size/font/font-size with a green-gradient (user-green) background"
    status: pending
  - id: cancel-button
    content: "Add a white Cancel button (same size, black/standard text) that declines the question via the existing deny control-response"
    status: pending
  - id: version-bump
    content: "Bump appcloud9.X in package.json to the next version"
    status: pending
  - id: build-install
    content: "npm run compile, package VSIX, install with --force; verify in-app"
    status: pending
isProject: false
---

# Claude Q & A Card — UI Tweaks

## Background

The `AskUserQuestion` interactive prompt ("CLAUDE Q & A" card) has three rough edges the user wants smoothed:

1. **A redundant tool card renders above it.** Because every `tool_use` block is turned into a generic tool message, the `AskUserQuestion` tool shows its own little "AskUserQuestion" card (purple "T" chip) right above the actual question panel. It's pure noise — the Q & A card already makes the intent obvious.
2. **The Submit button doesn't match the app aesthetic.** It's a plain default button; it should match the prompt pane's `Stop` button in size/font and carry the user-green gradient (the green we just made the user's accent color).
3. **There's no way to decline.** The only escape is the global `Stop` button, which is ambiguous (Stop vs. Submit don't read as a pair, and resuming may just re-ask). The user wants an explicit **Cancel** button paired with Submit — white, not red (so it isn't confused with Stop).

Intended outcome: a clean single Q & A card with a clear green **Submit** / white **Cancel** button pair, and no vestigial tool card.

## Approach

All three changes live in the AskUserQuestion component and one MessagesList line, plus a small extension-host tweak to carry a "cancelled" signal back to the CLI via the **already-existing** `behavior: 'deny'` control response. No new protocol is invented — Cancel reuses the same denial path that permission denials already use.

The **user-green gradient** is the Matrix green established earlier this session: `linear-gradient(180deg, #00ff41 0%, #008f11 100%)`, with dark text (`#001b00`) for legibility — consistent with the QUEUED badge precedent (dark text on bright green read well there).

## Files to modify

- [src/webview/components/MessagesList/MessagesList.tsx](../src/webview/components/MessagesList/MessagesList.tsx) — suppress the AskUserQuestion tool card (Issue 2).
- [src/webview/components/AskUserQuestion/AskUserQuestion.tsx](../src/webview/components/AskUserQuestion/AskUserQuestion.tsx) — add Cancel button + handler (Issue 3).
- [src/webview/components/AskUserQuestion/AskUserQuestion.less](../src/webview/components/AskUserQuestion/AskUserQuestion.less) — restyle Submit, style Cancel (Issues 1 & 3).
- [src/webview/vscode.ts](../src/webview/vscode.ts) — extend the `askUserQuestionResponse` message type with an optional `cancelled` flag.
- [src/webview.ts](../src/webview.ts) — pass `cancelled` through to the permissions handler.
- [src/permissions.ts](../src/permissions.ts) — in `handleAskUserQuestionResponse`, send a `behavior: 'deny'` control response when cancelled.
- [package.json](../package.json) — version bump.

## Implementation details

### Issue 2 — Suppress the vestigial tool card

The tool card comes from the generic tool-message path: `subprocess.ts` emits a `toolUse` message for every `tool_use` block (incl. `name: 'AskUserQuestion'`), `messages.ts` turns it into a `role: 'tool'` message, and `MessagesList.tsx` renders it via `ToolUseMessage`.

Cleanest fix — filter at the render layer in `MessagesList.tsx` (around line 42), where role dispatch happens:

```tsx
case 'tool' as any:
  // AskUserQuestion is shown as its own interactive Q&A card — don't also
  // render the generic tool card for it.
  if (msg.toolName === 'AskUserQuestion') return null;
  return <ToolUseMessage key={index} toolName={msg.toolName || 'Tool'} content={msg.content} rawInput={msg.rawInput} />;
```

This suppresses ONLY the AskUserQuestion tool card; all other tool cards are untouched. (The matching `tool_result` for it, if any, is empty/harmless — verify during implementation that no orphan result card appears; if it does, filter it the same way.)

### Issue 1 — Restyle Submit to match Stop + green gradient

Reference `Stop` button (`PromptPane.less` `.stop-inline-btn`): `font-size: 11px; font-weight: 500; padding: 3px 7px; border-radius: 4px; min-width: 39px; min-height: 11px; box-sizing: content-box; display:flex; align-items/justify center; gap: 2px; border: none;` with `font-family` inherited.

In `AskUserQuestion.less`, replace the generic `.btn.primary` styling for Submit with a rule that mirrors those metrics and uses the green gradient:

```less
.ask-question-buttons {
  margin-top: 10px;
  display: flex;
  gap: 6px;
}

.ask-question-submit {
  // Match .stop-inline-btn metrics so Submit/Cancel/Stop read as one family.
  font-size: 11px;
  font-weight: 500;
  padding: 3px 7px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  box-sizing: content-box;
  min-height: 11px;
  font-family: var(--vscode-font-family);
  // User-green gradient (Matrix green), dark text for legibility — matches the
  // QUEUED badge precedent.
  background: linear-gradient(180deg, #00ff41 0%, #008f11 100%);
  color: #001b00;

  &:hover { filter: brightness(1.08); }
}
```

Update the JSX `class` on the Submit button accordingly (from `btn primary` to `ask-question-submit`).

### Issue 3 — Add Cancel button (white, declines the question)

**Webview (`AskUserQuestion.tsx`):** add a `cancelAnswers` handler beside `submitAnswers`, and render a Cancel button next to Submit:

```tsx
function cancelAnswers(requestId: string) {
  post({ type: "askUserQuestionResponse", id: requestId, answers: {}, cancelled: true } as any);
  const q = pendingQuestions.value.find((q) => q.id === requestId);
  if (q) {
    pendingQuestions.value = pendingQuestions.value.filter((q) => q.id !== requestId);
    commitToMessages({ ...q, status: "cancelled", answers: {} });
  }
}
```

```tsx
{!resolved && (
  <div class="ask-question-buttons">
    <button class="ask-question-submit" type="button" onClick={handleSubmit}>Submit</button>
    <button class="ask-question-cancel" type="button" onClick={() => cancelAnswers(data.id)}>Cancel</button>
  </div>
)}
```

**Cancel styling (`AskUserQuestion.less`):** same metrics as Submit, white background, standard text — explicitly NOT red:

```less
.ask-question-cancel {
  font-size: 11px;
  font-weight: 500;
  padding: 3px 7px;
  border-radius: 4px;
  border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.15));
  cursor: pointer;
  box-sizing: content-box;
  min-height: 11px;
  font-family: var(--vscode-font-family);
  background: #ffffff;
  color: #000000;

  &:hover { filter: brightness(0.95); }
}
```

**Protocol (`cancelled` flag → existing deny path):**

- `vscode.ts`: extend the message union — `{ type: 'askUserQuestionResponse'; id: string; answers: Record<string,string>; cancelled?: boolean }`.
- `webview.ts`: pass it through — `permissions.handleAskUserQuestionResponse(message.id, message.answers, message.cancelled)`.
- `permissions.ts` `handleAskUserQuestionResponse(requestId, answers, cancelled?)`: when `cancelled`, send the **existing** denial shape instead of the allow shape:

```ts
const response = cancelled
  ? { type: 'control_response', response: { subtype: 'success', request_id: requestId,
      response: { behavior: 'deny', message: 'User declined to answer', interrupt: true,
                  toolUseID: pendingRequest.toolUseId } } }
  : { /* existing allow response with updatedInput.answers */ };
```

Then post `updateAskUserQuestionStatus` with `status: 'cancelled'` (the codebase already uses `'cancelled'` as the standard rejection status, e.g. in `cancelPendingPermissionRequests`). The component already renders a resolved/disabled state for `cancelled` (the `resolved` branch + the expired/cancelled decision block) — confirm the cancelled card reads sensibly; reuse the existing "This question expired" style or add a brief "Declined" variant if needed.

## Edge cases

- **Orphan tool_result for AskUserQuestion:** after suppressing the tool card, check no empty paired result card lingers; filter it the same way if it does.
- **stdin unavailable on cancel:** `handleAskUserQuestionResponse` already guards `getStdinAvailable()`; the cancel path inherits that guard.
- **Multiple pending questions:** Cancel targets a single card by `requestId` — unaffected cards remain.
- **Text-color contrast:** dark Submit text on bright green is deliberate (matches QUEUED badge). If it reads poorly in light themes, fall back to `#001b00` regardless since the gradient is fixed-color, not theme-driven.

## What we are NOT doing

- Not taming/hiding the free-text "Type your answer…" inputs, not capping line length, not adding dividers, not tightening radio alignment — those were earlier critique ideas the user did not select. Out of scope.
- Not changing the green accent palette (already shipped).
- Not removing the in-card "CLAUDE Q & A" header (the suppressed card is the separate *tool* card above the panel, not this header).

## Version bump

Bump `appcloud9.X` in `package.json` to the **next** version before packaging.

## Verification

1. `npm run compile` — clean build.
2. Package + install: `npx @vscode/vsce package --no-dependencies` then `cursor --install-extension <vsix> --force`. Reload the Cursor window.
3. Trigger a question (e.g. ask Claude something that makes it call AskUserQuestion). Confirm:
   - **No** separate "AskUserQuestion" tool card appears above the Q & A panel — only the CLAUDE Q & A card.
   - **Submit** is green-gradient, dark text, and visually matches the Stop button's size/font.
   - **Cancel** sits beside Submit, white with dark text, same size, clearly not red.
4. Click **Submit** with selections → answers flow through as before (card resolves to "answered").
5. Click **Cancel** on a fresh question → card resolves to cancelled, and Claude receives the decline (the turn proceeds without an answer rather than re-blocking). Confirm via the extension log (`handleAskUserQuestionResponse` deny branch) and that the CLI doesn't immediately re-ask.

---
name: Punchlist 5
overview: Follow-up fixes. Item 1 — the status-bar model tooltip never appears on hover. Item 2 — the terminal selector works but needs CSS/UX polish. Item 3 — the copy button on a message with a file path should put a cursor:// protocol link on the clipboard, not plain text.
todos:
  - id: tooltip-fix-overflow-clip
    content: "Stop the tooltip being clipped: move overflow/ellipsis to an inner text span so .session-status-model can drop overflow:hidden and let the overlay escape upward"
    status: completed
  - id: tooltip-resend-modelfull
    content: "Resend the modelFull message on the webviewReady handshake so the tooltip data isn't lost in the pre-mount race"
    status: completed
  - id: tooltip-verify-render
    content: "Verify end-to-end: hover the status-bar model name shows the full string, and the configured/running mismatch renders both labeled lines"
    status: pending
  - id: terminal-select-styling
    content: "Style the External terminal <select>: appearance reset, symmetric padding, sane width/max-width, room for the chevron so it isn't obscured when open"
    status: completed
  - id: terminal-select-placeholder
    content: "Add a 'Select a terminal…' placeholder option so the dropdown reads as populated before it's clicked"
    status: completed
  - id: terminal-custom-copy
    content: "Clarify the 'Other…' custom input: explain it takes a shell command to launch the terminal, with a concrete example"
    status: completed
  - id: copy-cursor-protocol
    content: "Copy button on a message with a file path should write a cursor:// protocol link to the clipboard instead of the raw path string"
    status: completed
  - id: tool-result-tighten-spacing
    content: "Tighten the gap between a tool-call message and its result so the result snugs up against the call; the dead space comes from the tool-call .message wrapper's margin-bottom, not the result's own CSS"
    status: completed
isProject: false
---

# Punchlist 5

Follow-up fixes for two punchlist-4 items that compiled cleanly but didn't behave correctly when run. Each item is a self-contained section below; todo ids are prefixed by item for traceability.

---

## 1. Status-bar model tooltip never appears

### Background

Punchlist 4 added a hover tooltip over the status-bar model name to reveal the full provider string (e.g. `us.anthropic.claude-opus-4-8[1m]`). It builds, but on hover **nothing renders** — confirmed by the user. The four tooltip todos in punchlist 4 were marked `completed` on "compiles cleanly," which never proved the runtime behavior.

### Root cause (primary): the overlay is clipped by its parent's `overflow: hidden`

The tooltip is an absolutely-positioned **child** of `.session-status-model` ([SessionStatus.tsx:113-124](src/webview/components/SessionStatus/SessionStatus.tsx)), and that element carries `overflow: hidden` for the inline label's ellipsis ([SessionStatus.less:47](src/webview/components/SessionStatus/SessionStatus.less)). An absolutely-positioned descendant is still clipped by an ancestor's `overflow: hidden`, so the tooltip renders into the DOM and is immediately clipped to nothing. This is exactly the "Overlay clipped by panel overflow" edge case punchlist 4 flagged — but the implementation put the ellipsis-clipping and the tooltip-anchor on the *same* element, the one combination that breaks.

### Root cause (secondary): `modelFull` may be dropped in the pre-mount race

`modelFull` is posted exactly once, inside `sendReadyMessage()` ([src/webview.ts](src/webview.ts)). That's the same pre-mount timing window that broke first-run: if it fires before the webview's `on('modelFull', …)` listener is live, the message bus drops it ([src/webview/vscode.ts:44](src/webview/vscode.ts)) and it's never resent. The short label survives this race only because it has a second source (`modelResolved` from the assistant stream); `modelFull` has no backup. So even after fixing the clip, the tooltip data may be absent.

### Approach

1. **Un-clip the overlay.** Split the two roles that are currently fused on one element. Wrap just the inline model text in an inner `<span>` (e.g. `.session-status-model-label`) that carries `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width`. Keep `.session-status-model` as `position: relative` **without** `overflow: hidden`, so the absolutely-positioned tooltip can escape upward. The hover trigger stays on `.session-status-model`.

2. **Resend `modelFull` on the ready handshake.** Add a `modelFull` post to the `webviewReady` case in the host switch ([src/webview.ts](src/webview.ts)) — reusing the handshake punchlist 4 built for first-run — so the data is (re)sent once the webview's listeners are guaranteed live. (Alternatively, post it from `checkFirstRun`'s sibling path; simplest is to factor a `sendModelFull()` and call it both in `sendReadyMessage` and on `webviewReady`.)

### Files to modify

- [src/webview/components/SessionStatus/SessionStatus.tsx](src/webview/components/SessionStatus/SessionStatus.tsx) — wrap the inline model text in an inner span; keep the tooltip as a sibling of that span inside `.session-status-model`.
- [src/webview/components/SessionStatus/SessionStatus.less](src/webview/components/SessionStatus/SessionStatus.less) — remove `overflow: hidden` from `.session-status-model`; add `.session-status-model-label` with the ellipsis rules and `max-width`.
- [src/webview.ts](src/webview.ts) — factor `sendModelFull()` (the existing `getFullModelString()` post) and call it on `webviewReady` as well as in `sendReadyMessage`.

### Implementation details

```tsx
// SessionStatus.tsx — model region: inner span clips, tooltip escapes
<div class="session-status-model">
  <span class="session-status-model-label">{resolvedModel.value}</span>
  {lines.length > 0 && (
    <div class="session-status-model-tooltip">
      {lines.map(l => (
        <div class="session-status-model-tooltip-line">
          {l.label && <span class="session-status-model-tooltip-label">{l.label}: </span>}
          {l.value}
        </div>
      ))}
    </div>
  )}
</div>
```

```less
// SessionStatus.less
&-model {
  position: relative;        // anchor — NO overflow:hidden here anymore
  opacity: 0.7;
  font-size: 11px;
  flex-shrink: 0;

  &:hover .session-status-model-tooltip { opacity: 1; visibility: visible; }
}

&-model-label {            // the inline text carries the ellipsis instead
  display: inline-block;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
// .session-status-model-tooltip block stays as-is (already correct)
```

```ts
// webview.ts — make modelFull survive the race
function sendModelFull(): void {
  const fullModel = settings.getFullModelString();
  postMessage({ type: "modelFull", data: { configured: fullModel.configured, resolvedEnv: fullModel.resolvedEnv } });
}
// call in sendReadyMessage() (existing spot) AND in the `webviewReady` case
```

### Edge cases

- **`max-width` on the inner span vs. flex parent** — the parent is `flex-shrink: 0`; confirm the label still ellipsizes and the row doesn't grow. Adjust which element holds `max-width` if the layout shifts.
- **Tooltip still clipped by a higher ancestor** — `.session-status` itself (the flex row) has no `overflow: hidden` today; verify no ancestor reintroduces clipping. If one does, the tooltip may need to render above the status bar via a higher stacking context.
- **`modelFull` empty** — when `~/.claude/settings.json` has no `model`/env, `tooltipLines` returns `[]` and nothing renders (correct — no false tooltip).
- **Mismatch case is the real test** — the user's config (`model` = 4.8[1m], `env.ANTHROPIC_MODEL` = 4.6) should produce the two-line `configured:` / `running:` tooltip. Use it as the verification fixture.

### What we are NOT doing

- Not changing the inline short label text or its truncation width — only moving where the clip lives.
- Not switching to a native `title` attribute — the styled overlay is the intended UX.

---

## 2. Terminal selector CSS/UX polish

### Background

The terminal selector (punchlist 4, item 3) detects installed terminals and works functionally — the user confirmed the dropdown populates with Terminal.app / iTerm2 / Ghostty / Other…. But it's visually rough and under-explained. Screenshot review surfaced:

- The `<select>` has **no CSS rule** targeting it. The only select styling in [SettingsModal.less:163](src/webview/components/SettingsModal/SettingsModal.less) is scoped to `.permissions-form-row select`, so the External-terminal dropdown renders as a raw native control.
- **Asymmetric whitespace** — more padding on the left than the right.
- **Chevron partly obscured when the dropdown is open.**
- **Far wider than needed** — it stretches to the full container (flex column, `align-items: stretch`) regardless of the short app names.
- **Looks empty until clicked** — no placeholder/leading hint.
- **The "Other…" custom input doesn't explain itself** — it only shows the `{{command}}` placeholder, never states it takes a shell command to launch your terminal.

### Approach

Add a `.settings-field select` style rule (or a dedicated class) in `SettingsModal.less`: reset native `appearance`, symmetric padding, a sensible `width`/`max-width` sized to content rather than full-stretch, and right padding that reserves room for the chevron so it isn't obscured. In the TSX, add a disabled "Select a terminal…" placeholder option and expand the custom-input hint to explain it's a shell command, with a concrete example.

### Files to modify

- [src/webview/components/SettingsModal/SettingsModal.less](src/webview/components/SettingsModal/SettingsModal.less) — add a `.settings-field select` rule (appearance reset, padding, width/max-width, chevron room). Mirror the input styling already in `.settings-field input[type="text"]` for consistency.
- [src/webview/components/SettingsModal/SettingsModal.tsx](src/webview/components/SettingsModal/SettingsModal.tsx) — add the placeholder option to the `<select>`; expand the custom-template hint copy.

### Implementation details

```less
// SettingsModal.less — under .settings-field
select {
  appearance: none;
  -webkit-appearance: none;
  width: auto;
  min-width: 200px;
  max-width: 100%;
  padding: 6px 28px 6px 8px;   // extra right padding for the chevron
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  font-size: 13px;
  box-sizing: border-box;
  // optional: a chevron via background-image SVG, themed with currentColor
}
```

```tsx
// SettingsModal.tsx — placeholder + clearer custom hint
<select value={...} onChange={...}>
  <option value="" disabled>Select a terminal…</option>
  {!detected && <option value="">Detecting…</option>}
  {terminals.map(t => <option value={t}>{t}</option>)}
  <option value={OTHER_TERMINAL}>Other…</option>
</select>
...
<p class="settings-field-hint">
  Shell command to launch your terminal. Use <code>{'{{command}}'}</code> where the
  Claude command should be inserted — e.g. <code>open -a kitty --args {'{{command}}'}</code>.
</p>
```

### Edge cases

- **Placeholder vs. a real stored value** — the disabled placeholder should only be the visible selection when nothing is chosen; once `externalApp` is set, that option is selected instead. Confirm `value` binding still drives selection correctly with the placeholder present.
- **`min-width` vs. narrow panel** — cap with `max-width: 100%` so it never overflows the modal on a narrow sidebar.
- **Chevron rendering** — if using `appearance: none`, the native chevron disappears; either add a CSS background chevron or accept a plain box. Decide during implementation (leaning: add a themed chevron so it still reads as a dropdown).

### What we are NOT doing

- Not changing detection or the launch logic — both work.
- Not adding the terminal-mode color pickers (separate concern).

### Open questions

- Add a CSS background-image chevron after `appearance: none`, or keep the native control and only fix padding/width? (Leaning: appearance reset + CSS chevron for a clean, theme-consistent look.)

---

## 3. Copy button should write a cursor:// protocol link for file paths

### Background

Messages that reference a file have two affordances:

1. **The file link itself** (`.tool-file-link`, [ToolMessage.tsx:61](src/webview/components/ToolMessage/ToolMessage.tsx)) — clicking it posts `openFile` and the host opens it via the Cursor/VS Code API (`vscode.Uri.file` → `openTextDocument` → `showTextDocument`, [webview.ts:1320](src/webview.ts)). This works as intended and is **not** changing.

2. **The copy button** (the little button upper-right of the message) — clicking it copies text built by `getCopyText()` ([ToolMessage.tsx:12](src/webview/components/ToolMessage/ToolMessage.tsx)), which for a file path just returns the raw `rawInput.file_path` string. So the clipboard gets plain text like `/Users/keldon/…/foo.ts`.

The desired behavior: when the copied content **is a file path**, the copy button should put a **`cursor://` protocol link** on the clipboard, so pasting it elsewhere yields a clickable "open in Cursor" link rather than bare text. The user verified via a clipboard-history app that only simple text is currently stored.

### Approach

When `getCopyText()` resolves to a file path (the `rawInput?.file_path` branch), wrap it as a `cursor://file/<absolute-path>` URL before copying. This is Cursor's fork of the VS Code `vscode://file/...` deep-link handler. Other copy cases (Bash command, generic content) stay plain text — only the file-path branch becomes a protocol link.

Key decisions to settle (see Open questions): the exact scheme (`cursor://file/…` vs `vscode://file/…`), whether the path needs to be absolute (it likely must be — relative paths won't resolve from a clipboard link), and whether to URL-encode the path.

### Files to modify

- [src/webview/components/ToolMessage/ToolMessage.tsx](src/webview/components/ToolMessage/ToolMessage.tsx) — in the copy handler / `getCopyText`, when the value is a file path, format it as a `cursor://file/<path>` link instead of the raw string. The link-open path (`openFile`) is untouched.
- Possibly [src/webview.ts](src/webview.ts) — if absolute-path resolution or URL construction is better done host-side (the host knows the workspace root and can resolve relative → absolute), add a small message round-trip or a host-built link. Decide based on whether `rawInput.file_path` is already absolute.

### Implementation details

```ts
// ToolMessage.tsx — only the file-path branch becomes a protocol link
function toCursorLink(filePath: string): string {
  // cursor:// is Cursor's deep-link scheme (fork of vscode://file/<abs-path>[:line[:col]])
  // Path should be absolute; encode to be safe.
  return `cursor://file/${encodeURI(filePath)}`;
}
// in the copy handler: if this is the file_path case, copy toCursorLink(filePath)
// otherwise copy the plain text as today.
```

Note both copy sinks: the webview tries `navigator.clipboard.writeText(copyText)` and also posts `copyToClipboard` to the host ([ToolMessage.tsx:35-39](src/webview/components/ToolMessage/ToolMessage.tsx), host at [webview.ts:513](src/webview.ts)). Whatever value we choose must be passed to **both** so the clipboard contents are identical regardless of which sink wins.

### Edge cases

- **Relative `file_path`** — a `cursor://` link needs an absolute path to resolve. If `rawInput.file_path` is relative, resolve it against the workspace root (likely host-side) before building the link.
- **Path with spaces / unicode / `#` / `?`** — must be URL-encoded so the link doesn't truncate. Use `encodeURI` (preserves slashes) and verify Cursor parses it back.
- **Non-file copies unaffected** — Bash commands and generic content must stay plain text; only the file-path branch changes.
- **Copy text was the user-visible affordance** — if someone wants the *bare path* (not a link), this changes that. Confirm the user wants the protocol link unconditionally for file paths (they did request exactly this).
- **Verify with the clipboard-history app** — the same tool that surfaced the bug is the verification fixture: after the fix, the stored clipboard entry should be `cursor://file/…`, not the bare path.

### What we are NOT doing

- Not changing the in-extension file link click behavior — it already opens via the Cursor API and works.
- Not adding line/column anchoring to the link unless trivially available (could be a later enhancement: `cursor://file/<path>:<line>`).

### Open questions

- Exact scheme: confirm `cursor://file/<abs-path>` is what Cursor's handler accepts (vs. `vscode://file/<abs-path>`). Neither this repo nor the reference project currently emits any protocol link, so this needs a quick real-Cursor test.
- Build the link in the webview (simple, but only has whatever path `rawInput` carries) or in the host (can resolve relative → absolute against the workspace, and already owns `copyToClipboard`)? Leaning host-side if paths can be relative.

---

## 4. Tighten vertical spacing between a tool call and its result

### Background

A tool call (e.g. `Edit`) and its `Result` render as two separate cards with a visible gap between them. The goal is to compact vertical space so the result snugs right up against the tool-call card — visually attached, still expandable to see detail. The user tried editing the result's CSS to close the gap and it didn't work, because **the gap isn't owned by the result**.

### Root cause

Both the tool-call message and the tool-result message are each wrapped in a `ChatMessage`, whose root `.message` element carries ([ChatMessage.less:2-3](src/webview/components/ChatMessage/ChatMessage.less)):

```less
.message {
  margin-bottom: 10px;
  padding: 4px 6px 6px 6px;
}
```

So the space *above* the result is produced by the **tool-call's** `.message { margin-bottom: 10px }` (plus its bottom padding), not by `.tool-result-message` (which already has no top margin: `margin: 0px 8px 4px`, [ToolResultMessage.less:2](src/webview/components/ToolResultMessage/ToolResultMessage.less)). Editing the result's own CSS can't close a gap that the preceding element owns. The two cards are siblings in `.messages` ([MessagesList.tsx:87](src/webview/components/MessagesList/MessagesList.tsx)), so this is a between-siblings spacing problem.

### Approach

Collapse the space specifically when a tool-result immediately follows its tool-call, without globally shrinking the 10px rhythm between unrelated messages. Options, in rough order of preference:

1. **Tag the pairing and target it.** Add a modifier class to the tool-call `.message` when a result follows (or to the result when it follows a call), then in CSS pull them together — e.g. the tool-call's `margin-bottom` drops to ~2px and the result's top is flush. This needs `MessagesList` to know adjacency (it maps the array, so it can look at `messages[i-1]`/`[i+1]` and pass a prop).
2. **CSS adjacency only.** If the rendered DOM places the result's `.message` directly after the tool-call's `.message`, a sibling combinator could work — but both share the same `.message.tool` / `.message.tool-result` classes, and the combinator would have to key off the type modifier (`.message.tool + .message.tool-result`). Verify the `type` class lands on the root (`ChatMessage` sets `class={`message ${type}`}`, and tool-result type is `tool-result`), which makes `.message.tool + .message.tool-result { margin-top: -6px }` (or reduce the call's bottom) viable with **no TSX change**. This is the cleanest if the type classes are reliable.
3. Optionally also trim `.tool-result-message`'s own `margin` and the `.message` padding on the result for an even tighter join.

Leaning option 2 (pure CSS via the type-modifier sibling selector) since `ChatMessage` already emits `.message.tool` and `.message.tool-result` — confirm in the live DOM, then it's a one-rule fix.

### Files to modify

- [src/webview/components/ChatMessage/ChatMessage.less](src/webview/components/ChatMessage/ChatMessage.less) — add a rule collapsing the gap between `.message.tool` and a following `.message.tool-result` (reduce the call's `margin-bottom`/padding-bottom, and/or negative `margin-top` on the result).
- [src/webview/components/ToolResultMessage/ToolResultMessage.less](src/webview/components/ToolResultMessage/ToolResultMessage.less) — optionally trim its `margin` top for a flush join.
- [src/webview/components/MessagesList/MessagesList.tsx](src/webview/components/MessagesList/MessagesList.tsx) — only if option 1 is chosen (pass an adjacency prop); not needed for the pure-CSS option.

### Implementation details

```less
// ChatMessage.less — pure-CSS adjacency fix (verify type classes in live DOM first)
.message.tool {
  // when a result follows, the call shouldn't push it 10px away
  &:has(+ .message.tool-result) {
    margin-bottom: 2px;
  }
}
.message.tool + .message.tool-result {
  margin-top: 0;
}
```

(`:has(+ …)` is supported in the webview's Chromium; if avoiding `:has`, just reduce `.message.tool`'s `margin-bottom` globally — tool calls are almost always followed by a result — or use the adjacency-prop approach.)

### Edge cases

- **Tool call with no result** (still running, or errored before result) — don't leave it visually orphaned/cramped. The `:has(+ .message.tool-result)` guard handles this: no result sibling → normal 10px spacing.
- **Result without an expansion** — the collapsed look should still read as "attached to the call above," not floating between two calls. The screenshot shows the danger: a result can sit visually closer to the *next* call than its own. Tightening the call→result join (and keeping normal space after the result) fixes the grouping.
- **Type classes not on the root** — if `ChatMessage` doesn't reliably emit `.tool` / `.tool-result` on `.message`, option 2 fails; fall back to the adjacency prop (option 1).
- **Don't shrink unrelated spacing** — assistant/user message rhythm should stay at 10px; scope the change to the tool↔result pair only.

### What we are NOT doing

- Not merging the two into a single component/card — they stay separate, expandable; only the spacing changes.
- Not changing the result's expand/collapse behavior.

### Open questions

- Confirm in the live DOM that `.message.tool` and `.message.tool-result` are the actual root classes (so the sibling-combinator fix works with zero TSX change). If yes, this is a one-rule CSS change.

---

<!-- Add item 5 below this line -->

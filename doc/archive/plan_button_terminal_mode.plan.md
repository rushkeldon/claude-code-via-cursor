---
name: Plan button enters green pass-through mode
overview: >
  The Plan button injects "/modes plan ./doc" into the prompt input but leaves
  the field in normal (grey) mode, because the green pass-through state
  (terminalMode) is only ever set from a real keystroke in handleInput. Make the
  Plan button flip terminalMode on as it injects, so the input turns green
  immediately — matching exactly what typing "/" does.
todos:
  - id: inject-enter-terminal
    content: "injectPlanCommand: set terminalMode + terminalInput alongside textarea.value so the field enters green pass-through mode on click"
    status: pending
  - id: fetch-command-list
    content: "Ensure the command list is fetched on Plan-button entry (parity with enterTerminalMode) so CommandAutocomplete has data"
    status: pending
  - id: verify-build-package
    content: "Build, bump version, package VSIX, install with --force; verify green border + placeholder + Enter-to-send pass-through behave"
    status: pending
isProject: false
---

# Plan button enters green pass-through mode

## Background

The Plan button is a prompt-injector (by design — see the comment at
[PromptPane.tsx](../src/webview/components/PromptPane/PromptPane.tsx) line 261):
clicking it drops `/modes plan ./doc` into the input, focused with the cursor at
the end, and does **not** send. The user can edit the target dir, then send.

The regression: when you type `/` as the first character, `handleInput` calls
`enterTerminalMode()`, which flips the `terminalMode` signal on — turning the
input green (border + font color via `--terminal-*` vars), swapping the
placeholder to "Slash command — sent straight to Claude Code…", showing the
`CommandAutocomplete` dropdown, and rerouting Enter to `executeTerminalCommand`
(raw pass-through). But the **Plan button sets `textarea.value` directly**, which
fires no `input` event, so `handleInput` never runs and `terminalMode` stays
`false`. The injected command looks like an ordinary grey message instead of the
obvious green pass-through it should be.

Confirmed design intent (user, this session): the Plan button **should**
auto-enter green mode on click.

## Approach

`terminalMode` / `terminalInput` are signals in
[PromptPane.tsx](../src/webview/components/PromptPane/PromptPane.tsx) (lines
23–24). Everything that renders the green state already keys off
`terminalMode.value` (class `terminal-mode`, the placeholder, the inline border/
color style, the `CommandAutocomplete` mount, and the relative-position wrapper —
lines 501–531). `executeTerminalCommand` reads `terminalInput.value` first
(line 229) and `CommandAutocomplete`'s `filter` prop is `terminalInput.value`
(line 508). So the *only* gap is that `injectPlanCommand` doesn't set those two
signals.

The fix is to make `injectPlanCommand` do what `enterTerminalMode` does, plus the
text injection: set `terminalMode = true`, set `terminalInput` to the injected
string (so the autocomplete filter and Enter-to-execute read the right value),
write the textarea, focus, place the cursor at the end, and fetch the command
list. This is faithful to the existing green-mode entry path rather than a
parallel mechanism.

One subtlety worth a glance during implementation: `handleInput`'s terminal
branch exits green mode if the field no longer `startsWith("/")` (line 201).
`/modes plan ./doc` starts with `/`, so editing the dir keeps green mode on; only
deleting back past the leading `/` drops it — which is the correct, consistent
behavior.

## Files to modify

- [src/webview/components/PromptPane/PromptPane.tsx](../src/webview/components/PromptPane/PromptPane.tsx)
  — `injectPlanCommand` (lines 266–274): set `terminalMode`/`terminalInput` and
  fetch the command list, in addition to the existing textarea write.
- [package.json](../package.json) — bump `appcloud9.X` to the **next** version
  before packaging.

## Implementation details

Rewrite `injectPlanCommand` (currently lines 266–274) to:

```tsx
function injectPlanCommand() {
  const textarea = textareaRef.current;
  if (!textarea) return;
  const cmd = "/modes plan ./doc";
  textarea.value = cmd;
  autoResize(textarea);
  // Enter green pass-through mode just as typing "/" does — the button injects
  // a command, so the input should LOOK like a command (green border, command
  // placeholder, autocomplete, Enter = raw pass-through). Setting textarea.value
  // fires no input event, so we flip the signals ourselves.
  terminalMode.value = true;
  terminalInput.value = cmd;
  post({ type: "fetchCommandList" } as any);
  textarea.focus();
  const end = textarea.value.length;
  textarea.setSelectionRange(end, end);
}
```

Note this duplicates the `fetchCommandList` post + the `terminalMode`/
`terminalInput` assignment from `enterTerminalMode`. Acceptable given the cursor-
positioning and value-injection differ; do **not** over-refactor into a shared
helper unless it falls out cleanly.

## Edge cases

- **User edits the directory** (`/modes plan ./src`): still starts with `/`, so
  `handleInput` keeps green mode on. Correct.
- **User deletes the whole line / past the leading `/`**: `handleInput`'s
  `!startsWith("/")` branch calls `exitTerminalMode()`, dropping green mode.
  Correct and already handled.
- **Send via button vs Enter**: `sendMessage` already resets `terminalMode` when
  it was set (lines 157–160), and Enter in green mode routes to
  `executeTerminalCommand` (line 180–183). Both paths already cover the
  now-green Plan injection — no change needed.
- **CommandAutocomplete filter** = `terminalInput.value` = `/modes plan ./doc`.
  The dropdown will filter to matching commands (likely just `/modes`); harmless
  and consistent with typing the same text.

## What we are NOT doing

- Not changing the injected command string or the modes-skill routing.
- Not auto-sending — the Plan button stays inject-only by design.
- Not refactoring the terminal-mode machinery or extracting a shared
  enter-with-text helper unless trivial.

## Open questions

- None. Design intent confirmed: auto-enter green mode on Plan-button click.

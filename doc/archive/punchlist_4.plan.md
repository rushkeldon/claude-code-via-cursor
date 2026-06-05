---
name: Punchlist 4
overview: A running punchlist of polish items. Item 1 — a hover tooltip/overlay on the status bar model name that reveals the full provider-qualified model string (e.g. `us.anthropic.claude-opus-4-8[1m]`), sourced from `~/.claude/settings.json`'s `model` key, since the short inline label omits the region prefix and context-window variant tag. More items to follow.
todos:
  - id: model-tooltip-source-full-string
    content: "Extension host: read the full model string from ~/.claude/settings.json `model` key and expose it alongside the resolved model"
    status: completed
  - id: model-tooltip-plumb-to-webview
    content: "Send the full provider string to the webview in a new field on the model message (don't overload the short label)"
    status: completed
  - id: model-tooltip-overlay
    content: "Render a hover overlay above the status bar model name showing the full string, right-aligned to stay within the panel"
    status: completed
  - id: model-tooltip-handle-mismatch
    content: "When configured `model` and resolved `env.ANTHROPIC_MODEL` disagree, show both in the tooltip so the displayed string is honest"
    status: completed
  - id: first-run-fix-timing-race
    content: "Fix first-run not appearing: gate firstRunPrompt on the webview-ready handshake (or buffer it) so it isn't posted before listeners mount"
    status: completed
  - id: first-run-verify-reset-flow
    content: "Verify the Settings 'Reset First-Run' path clears both flags and that a fresh launch re-shows the welcome modal end to end"
    status: completed
  - id: terminal-detect-installed
    content: "Extension host: detect installed terminal emulators for the current OS via `which`/path probes; expose via a getDetectedTerminals message"
    status: completed
  - id: terminal-settings-ui
    content: "Add a Terminal section to the Settings modal: 'Use integrated terminal' checkbox + detected-terminal dropdown + 'Other' custom-template input"
    status: completed
  - id: terminal-settings-plumbing
    content: "Include terminal.* keys in sendCurrentSettings and FullSettings so the Settings UI can read/write them"
    status: completed
isProject: false
---

# Punchlist 4

A running list of polish items for the extension. Each item is a self-contained section below; todo ids are prefixed by item for traceability. More items will be appended.

---

## 1. Status bar model name tooltip

### Background

The status bar's right-aligned model name ([SessionStatus.tsx:90](src/webview/components/SessionStatus/SessionStatus.tsx)) shows a short label like `claude-opus-4-8`. The user wants to see the **full provider-qualified string** — e.g. `us.anthropic.claude-opus-4-8[1m]` — which includes the inference-region prefix (`us.`), the provider namespace (`anthropic.`), the model ID, and the context-window variant tag (`[1m]` = 1-million-token long-context profile).

That full string is too wide to show inline (the panel/sidebar isn't always wide enough), so it should appear on **mouseover** as a tooltip or small centered overlay positioned directly above the name. Because the name sits at the right edge of the status bar, the overlay must be **right-aligned** (anchored to the right of the trigger) so it doesn't overflow the panel's left or right boundary.

### Where the full string actually comes from (investigated)

This is the crux. Two distinct channels were checked against the user's real config and transcripts:

1. **CLI stream (`message.model`)** — [src/subprocess.ts:631](src/subprocess.ts) already forwards `jsonData.message.model` as a `modelResolved` message. But this field only ever contains the **bare** ID. Confirmed against captured transcripts: the only values seen are `claude-opus-4-8`, `claude-opus-4-6`, and `<synthetic>`. **No region prefix, no `[1m]` tag.** So the CLI stream alone cannot produce the full string.

2. **`~/.claude/settings.json` top-level `model` key** — this *does* hold the full string. In the user's config:
   ```json
   {
     "env": {
       "ANTHROPIC_MODEL": "global.anthropic.claude-opus-4-6-v1",
       ...
     },
     "model": "us.anthropic.claude-opus-4-8[1m]"
   }
   ```
   The `model` key is exactly what the user wants to surface. This is the source the tooltip should read.

**Important caveat — the two can disagree.** In the config above, top-level `model` is Opus 4.8 (1m) but `env.ANTHROPIC_MODEL` is Opus 4.6, and at runtime the env var wins (this was the original "status bar shows 4.6" bug). So the tooltip must not blindly show the `model` key as if it were authoritative — it should distinguish the *configured default* from the *resolved* model. See task 4.

### Approach

Source the full string host-side by reading `~/.claude/settings.json`'s `model` key, plumb it to the webview as a **separate field** (not by overloading the existing short label that `SessionStatus` renders inline), and render a right-anchored hover overlay above the model name. The inline display stays exactly as it is today — short and ellipsized.

For positioning, a pure-CSS overlay (absolutely-positioned child of the model element, revealed on `:hover`) is preferred over the native `title` attribute because the user wants a "good sized" styled overlay, and native tooltips can't be right-anchored or styled. Anchor it with `right: 0` relative to the model element so it grows leftward and stays inside the panel.

### Files to modify

- [src/settings.ts](src/settings.ts) — add a function (e.g. `getFullModelString()`) that reads `~/.claude/settings.json` and returns the top-level `model` key (plus the `env.ANTHROPIC_MODEL` value for the mismatch case). Resolve `~` via `os.homedir()`. Handle missing file / missing key gracefully.
- [src/webview.ts](src/webview.ts) — include the full string in the outgoing model message (near the existing `model: settings.getDisplayModel()` at [src/webview.ts:326](src/webview.ts)).
- [src/webview/vscode.ts](src/webview/vscode.ts) — extend the relevant `MessageFromExtension` variant with a `fullModel?: string` field (and `configuredModel` / `resolvedModelEnv` if we surface the mismatch).
- [src/webview/state/session.ts](src/webview/state/session.ts) — add a `fullModel` signal, populated from the new message field in the existing model handlers.
- [src/webview/components/SessionStatus/SessionStatus.tsx](src/webview/components/SessionStatus/SessionStatus.tsx) — wrap the `.session-status-model` div with the hover-overlay markup, reading `fullModel`.
- [src/webview/components/SessionStatus/SessionStatus.less](src/webview/components/SessionStatus/SessionStatus.less) — add the overlay styles (positioning, right-anchor, appearance).

### Implementation details

**Host — read the full string ([src/settings.ts](src/settings.ts)):**

```ts
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export function getFullModelString(): { configured?: string; resolvedEnv?: string } {
  try {
    const p = path.join(os.homedir(), '.claude', 'settings.json');
    const raw = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    return {
      configured: json.model,                      // e.g. "us.anthropic.claude-opus-4-8[1m]"
      resolvedEnv: json.env?.ANTHROPIC_MODEL,       // e.g. "global.anthropic.claude-opus-4-6-v1"
    };
  } catch {
    return {};
  }
}
```

**Webview — overlay markup ([SessionStatus.tsx](src/webview/components/SessionStatus/SessionStatus.tsx)):**

```tsx
<div class="session-status-model">
  {resolvedModel.value}
  {fullModel.value && (
    <div class="session-status-model-tooltip">{fullModel.value}</div>
  )}
</div>
```

**Webview — overlay styles ([SessionStatus.less](src/webview/components/SessionStatus/SessionStatus.less)):**

```less
&-model {
  position: relative;        // anchor for the overlay
  // existing ellipsis rules stay

  &:hover .session-status-model-tooltip {
    opacity: 1;
    visibility: visible;
  }
}

&-model-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);  // directly above the name
  right: 0;                  // right-anchored: grows leftward, stays in-panel
  max-width: 320px;
  white-space: nowrap;
  padding: 6px 10px;
  border-radius: 4px;
  background: var(--vscode-editorHoverWidget-background);
  color: var(--vscode-editorHoverWidget-foreground);
  border: 1px solid var(--vscode-editorHoverWidget-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  font-size: 11px;
  z-index: 10;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.12s ease;
  pointer-events: none;      // don't let the overlay eat the hover
}
```

(`right: 0` satisfies the "aligned to the right so it stays within the panel" requirement. The model name is the rightmost element, so an overlay anchored to its right edge can never overflow the right side of the panel, and it expands leftward into available space.)

### Edge cases

- **`~/.claude/settings.json` missing or unparseable** — `getFullModelString()` returns `{}`; webview gets no `fullModel`; tooltip simply doesn't render (inline label unchanged). No error surfaced.
- **`model` key absent from settings.json** — same as above; consider falling back to the streamed `message.model` so the tooltip still shows *something* fuller than the tier label, even if it lacks the `[1m]`/region parts.
- **Configured vs. resolved mismatch** (task 4) — when `configured` and `resolvedEnv` differ, the tooltip should show both, clearly labeled (e.g. "configured: …" / "running: …"), so it never misrepresents which model is actually answering. Env var wins at runtime.
- **Very long strings** — `max-width` + the right-anchor keep it inside the panel; allow wrapping if needed rather than overflowing.
- **Overlay clipped by panel overflow** — if a parent container has `overflow: hidden`, the absolutely-positioned overlay may get clipped. Verify the status bar's ancestors don't clip; if they do, the overlay may need to be portaled or the ancestor's overflow adjusted.

### What we are NOT doing

- Not changing the inline short label or its ellipsis behavior — it stays compact.
- Not fixing the underlying `env.ANTHROPIC_MODEL`-vs-`model` config disagreement — that's a settings concern, not this UI task. We only *display* it honestly.
- Not parsing/prettifying the `[1m]` tag into prose in the status bar itself — the tooltip shows the raw provider string verbatim.

### Open questions

- For the mismatch case: show both strings stacked in the tooltip, or show the resolved one inline and the configured one only in the tooltip? (Leaning: tooltip shows both, labeled.)
- Should the tooltip also appear for the short label when there's no full string available, or only when `fullModel` exists? (Leaning: only when there's something more to show.)

---

## 2. First-run experience not appearing after reset

### Background

The user enabled the first-run experience from Settings → "Reset First-Run" ([SettingsModal.tsx:281](src/webview/components/SettingsModal/SettingsModal.tsx)), saw the confirmation toast ("First-run experience will show on next launch."), but the welcome modal **did not appear** on the next session. The expectation is: when the first-run flag is absent or cleared, the welcome screen shows.

Unlike the earlier `punchlist_2.plan.md` note (which claimed there was *no* `firstRunPrompt` handler), the component and wiring now exist:
- [src/webview/components/FirstRun/FirstRun.tsx](src/webview/components/FirstRun/FirstRun.tsx) registers `on('firstRunPrompt', …)` at module load and flips `firstRunVisible`.
- It's mounted in [src/webview/App.tsx:69](src/webview/App.tsx).
- The reset handler ([src/webview.ts:407](src/webview.ts)) clears both `globalState("hasShownFirstRun")` and the `firstRun.hasShown` setting.

So the *handler* exists. The bug is elsewhere.

### Root cause (primary hypothesis): the prompt is posted before the webview can hear it

`checkFirstRun()` runs synchronously inside `initializeWebview()` ([src/webview.ts:262](src/webview.ts)), which fires the instant the webview HTML is set ([showInWebview → initializeWebview, src/webview.ts:147](src/webview.ts)). At that moment the Preact bundle may not have executed yet, so `FirstRun.tsx`'s `on('firstRunPrompt', …)` listener isn't registered.

Critically, the webview's message bus does **not buffer**: `window.addEventListener('message', …)` ([src/webview/vscode.ts:44](src/webview/vscode.ts)) looks up handlers at delivery time and drops the message if none are registered yet. There's no replay. So a `firstRunPrompt` posted during `initializeWebview()` — before the bundle mounts — is **silently lost**. The `ready` message uses a `setTimeout(…, 100)` precisely because of this timing problem, but `checkFirstRun()` has no such delay and no handshake.

Then the damage compounds: `checkFirstRun()` *unconditionally* sets `hasShownFirstRun = true` and `firstRun.hasShown = true` right after posting ([src/webview.ts:300-301](src/webview.ts)) — even though the webview never received the prompt. So the flags say "shown" when nothing was shown, and the next launch early-returns at the gate ([src/webview.ts:271](src/webview.ts)). One lost message permanently suppresses the experience until another manual reset.

### Approach

Two fixes, ordered by importance:

1. **Don't post `firstRunPrompt` until the webview signals it's ready.** The webview should send an explicit "webview mounted / ready" message to the host (a new `MessageToExtension`), and the host should defer `checkFirstRun()`'s post until it arrives. Alternatively/additionally, buffer late-arriving messages host-side or replay on ready. Mirror whatever handshake `sendReadyMessage()` relies on rather than inventing a second mechanism.

2. **Only mark "shown" once the webview confirms it displayed the modal.** Move the `hasShownFirstRun = true` / `firstRun.hasShown = true` writes ([src/webview.ts:300-301](src/webview.ts)) out of the fire-and-forget post path. Set them in response to a webview acknowledgement (e.g. a `firstRunShown` message the `FirstRun` component posts when it actually renders), so a dropped or never-rendered prompt can't latch the flags to "shown."

### Files to modify

- [src/webview.ts](src/webview.ts) — defer/guard the `firstRunPrompt` post behind the ready handshake; move the flag-setting writes to an ack handler; add a `firstRunShown` (or similar) case to the message switch.
- [src/webview/vscode.ts](src/webview/vscode.ts) — add the webview-ready and/or `firstRunShown` message types to the union(s); consider a tiny buffer/replay so module-load-time posts aren't lost.
- [src/webview/components/FirstRun/FirstRun.tsx](src/webview/components/FirstRun/FirstRun.tsx) — post the `firstRunShown` ack when the modal actually becomes visible.
- [src/webview/App.tsx](src/webview/App.tsx) — if a global "webview ready" ping is introduced, emit it once on mount.

### Edge cases

- **`installed_plugins.json` missing/unparseable** — already handled (try/catch defaults both flags to false); fine to keep.
- **Reset while a session is live** — reset only flips persisted flags; the modal shouldn't pop mid-session. Show it on the next init, consistent with the toast's "on next launch" wording.
- **Both `globalState` and the contributed setting** — keep them in sync; the gate reads both ([src/webview.ts:271](src/webview.ts)). Don't fix one and leave the other stale.
- **Reinit on visibility change** — `onDidChangeVisibility` → `reinitializeWebview()` → `initializeWebview()` ([src/webview.ts:237](src/webview.ts)) calls `checkFirstRun()` again. Ensure the show-once semantics still hold (the ack-driven flag write covers this).

### What we are NOT doing

- Not redesigning the welcome modal's content/skills-install UI — only fixing *whether/when* it appears.
- Not changing the Settings reset button UI — it already posts `resetFirstRun` correctly.

### Open questions

- Is there an existing "webview booted" signal the host already trusts, or do we add a dedicated one? (Need to confirm how `sendReadyMessage`'s 100ms delay is consumed on the webview side — is anything actually waited on, or is it purely a guess?)
- Should first-run show on *every* fresh launch until the user explicitly installs/dismisses, or strictly once? Current code aims for once-ever; confirm the user's intent matches.

---

## 3. Terminal selection in Settings (per-OS, `which`-detected)

### Background

A prior plan — [slash_command_passthrough.plan.md](../../.cursor/plans/slash_command_passthrough.plan.md), todo `external-terminal-settings` — called for a terminal preference in Settings: a "Use Cursor's integrated terminal" checkbox (default on), and when unchecked, **a per-OS dropdown of detected terminals** plus an "Other" custom-template option. That todo is marked `completed`, but the **settings UI and the detection were never actually built**. The user confirmed: the launcher backend landed, but the settings surface to pick a terminal did not.

What *does* exist today (verified):
- **Config schema** — `package.json` declares `claudeCodeChat.terminal.useIntegrated` (bool, default true), `terminal.externalApp` (string), `terminal.customTemplate` (string), plus `terminal.borderColor` / `terminal.fontColor`.
- **Launcher backend** — `launchSlashCommand()` ([src/webview.ts:1032](src/webview.ts)) reads `useIntegrated`, then `externalApp`/`customTemplate`, and `getTerminalLaunchCommand()` ([src/webview.ts:1205](src/webview.ts)) maps a known app name → a per-OS launch command (Terminal.app, iTerm2, kitty, Ghostty, Warp on macOS; Windows Terminal/PowerShell/cmd on Windows; kitty/alacritty/gnome-terminal/xterm on Linux).

What's **missing** (the actual work):
1. **No Settings UI** — `SettingsModal.tsx` has WSL, Permissions, Skills, First-Run, Customize sections, but **no Terminal section**. The user has no way to set `useIntegrated`, pick an `externalApp`, or enter a `customTemplate`. (The only "terminal" mention in the modal is the unrelated `which claude` hint at [SettingsModal.tsx:63](src/webview/components/SettingsModal/SettingsModal.tsx).)
2. **No detection** — nothing probes the OS for which terminals are actually installed (`which`/path checks). The dropdown the prior plan described ("a list that makes sense for the OS we're on") has no data source.
3. **No plumbing** — `sendCurrentSettings()` ([src/settings.ts:40](src/settings.ts)) does **not** include any `terminal.*` key, and `FullSettings` ([src/webview/state/settings.ts:5](src/webview/state/settings.ts)) doesn't declare them. So even if a UI were added, it couldn't read current values.

### Approach

Three pieces, mirroring patterns already in the codebase:

1. **Detect installed terminals (host).** Add a `getDetectedTerminals` request/response message, modeled on the existing `checkSkillsInstalled` → `skillsStatus` round-trip ([src/webview.ts](src/webview.ts)). For the current `process.platform`, probe a candidate list and return only those found. On macOS, prefer checking `/Applications` (and `~/Applications`) for `.app` bundles (Terminal is always present; iTerm, Ghostty, Warp, kitty, Alacritty if installed) and fall back to `which` for CLI-launchable ones (kitty, alacritty). On Linux, `which` each of `kitty`, `alacritty`, `gnome-terminal`, `konsole`, `xterm`. On Windows, probe for `wt`, `pwsh`, `powershell`, `cmd`. The detected names must match the substrings `getTerminalLaunchCommand()` already keys on, so detection and launching stay in sync.

2. **Add a Terminal section to the Settings modal.** A new `TerminalSection()` component in [SettingsModal.tsx](src/webview/components/SettingsModal/SettingsModal.tsx) following the `WSLSection` shape: a "Use integrated terminal" checkbox bound to `terminal.useIntegrated`; when unchecked, a `<select>` populated from the detected-terminals list (bound to `terminal.externalApp`), with an "Other…" entry that reveals a text input for `terminal.customTemplate` (with a `{{command}}` placeholder hint). Request detection lazily on first render, exactly like `SkillsSection` calls `checkStatus()`.

3. **Plumb `terminal.*` through settings.** Add the keys to `sendCurrentSettings()` and to the `FullSettings` interface so the section can read current values and `updateSetting()` can write them (the write path already works generically via the `updateSettings` message).

### Files to modify

- [src/webview.ts](src/webview.ts) — add a `getDetectedTerminals` case in the message switch; implement a `detectTerminals()` host function that probes per-OS and posts `detectedTerminals`.
- [src/settings.ts](src/settings.ts) — add `terminal.useIntegrated`, `terminal.externalApp`, `terminal.customTemplate` (and optionally the two color keys) to the `sendCurrentSettings()` payload.
- [src/webview/state/settings.ts](src/webview/state/settings.ts) — extend `FullSettings` with the `terminal.*` keys; add a `detectedTerminals` signal fed by an `on('detectedTerminals', …)` handler.
- [src/webview/components/SettingsModal/SettingsModal.tsx](src/webview/components/SettingsModal/SettingsModal.tsx) — add `TerminalSection()` and render it in the modal (e.g. after `WSLSection`).
- [src/webview/vscode.ts](src/webview/vscode.ts) — add `getDetectedTerminals` to `MessageToExtension` and `detectedTerminals` to `MessageFromExtension`.

### Implementation details

**Host detection (mirror `checkSkillsInstalled`):**

```ts
function detectTerminals(): void {
  const platform = process.platform;
  const found: string[] = [];
  const has = (cmd: string) => {
    try { cp.execFileSync('which', [cmd], { stdio: 'ignore' }); return true; }
    catch { return false; }
  };
  if (platform === 'darwin') {
    if (fs.existsSync('/Applications/Utilities/Terminal.app') ||
        fs.existsSync('/System/Applications/Utilities/Terminal.app')) found.push('Terminal.app');
    if (fs.existsSync('/Applications/iTerm.app')) found.push('iTerm2');
    if (fs.existsSync('/Applications/Ghostty.app')) found.push('Ghostty');
    if (fs.existsSync('/Applications/Warp.app')) found.push('Warp');
    if (has('kitty')) found.push('kitty');
    if (has('alacritty')) found.push('alacritty');
  } else if (platform === 'win32') {
    for (const c of ['wt', 'pwsh', 'powershell', 'cmd']) if (has(c)) found.push(c);
  } else {
    for (const c of ['kitty', 'alacritty', 'gnome-terminal', 'konsole', 'xterm']) if (has(c)) found.push(c);
  }
  postMessage({ type: 'detectedTerminals', data: { terminals: found, platform } });
}
```

(On Windows `which` may not exist; use `where` there, or guard with a try/catch that treats failure as "not found". Keep the returned names aligned with the substrings in `getTerminalLaunchCommand()`.)

**Settings UI (mirror `WSLSection` + `SkillsSection` lazy fetch):**

```tsx
function TerminalSection() {
  const s = fullSettings.value;
  const detected = detectedTerminals.value;
  if (!s) return null;
  if (!detected) { post({ type: 'getDetectedTerminals' } as any); /* render "Detecting…" */ }

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">Terminal</h3>
      <label class="settings-checkbox">
        <input type="checkbox" checked={s['terminal.useIntegrated']}
          onChange={e => updateSetting('terminal.useIntegrated', (e.target as HTMLInputElement).checked)} />
        Use integrated terminal
      </label>
      {!s['terminal.useIntegrated'] && (
        <div class="settings-sub-fields">
          <div class="settings-field">
            <label>External terminal</label>
            <select value={s['terminal.externalApp']}
              onChange={e => updateSetting('terminal.externalApp', (e.target as HTMLSelectElement).value)}>
              {(detected?.terminals ?? []).map(t => <option value={t}>{t}</option>)}
              <option value="__other__">Other…</option>
            </select>
          </div>
          {s['terminal.externalApp'] === '__other__' && (
            <div class="settings-field">
              <label>Custom launch template</label>
              <input type="text" value={s['terminal.customTemplate']} placeholder="my-term -e {{command}}"
                onBlur={e => updateSetting('terminal.customTemplate', (e.target as HTMLInputElement).value)} />
              <p class="settings-field-hint">Use <code>{{command}}</code> as the placeholder for the command to run.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### Edge cases

- **`which`/`where` unavailable or throws** — treat as "terminal not found"; never let detection crash the host. macOS always has Terminal.app, so the list is never empty there.
- **Detected name ↔ launch-template mismatch** — the returned names MUST be substrings `getTerminalLaunchCommand()` recognizes (`iTerm`, `kitty`, `Ghostty`, `Warp`, `Windows Terminal`/`wt`, `PowerShell`/`pwsh`, `alacritty`, `gnome-terminal`). If detection adds a new terminal, add its case to `getTerminalLaunchCommand()` too, or it falls through to the platform default.
- **"Other" selected but template empty or missing `{{command}}`** — the launcher already no-ops on empty `customTemplate`; surface a hint in the UI and consider a soft warning. (Prior plan flagged this as an open question.)
- **`externalApp` set to a since-uninstalled terminal** — detection won't list it; the stored value persists. Either keep showing it as a stale selected option or reset to integrated. Decide in the UI (leaning: keep it selectable but show it's not detected).
- **Settings payload bloat** — only add the terminal keys actually needed by the UI; the color keys (`borderColor`/`fontColor`) are a separate concern (terminal-mode styling) and may already be plumbed elsewhere — verify before duplicating.

### What we are NOT doing

- Not rebuilding the launcher or `getTerminalLaunchCommand()` logic — it works; we're feeding it a user-chosen value.
- Not adding the terminal-mode color pickers here — separate item if needed.
- Not capturing external-terminal output back into the webview (explicitly out of scope in the prior plan).
- Not Windows/Linux hardware testing in this pass — implement per-OS branches, but the user's environment is macOS; cross-OS verification is follow-up.

### Open questions

- Should "Use integrated terminal" stay the default-on, with the selector only appearing when unchecked (matches the prior plan), or should detection run eagerly so the dropdown is pre-populated the moment the user unchecks it? (Leaning: lazy-detect on section render so the list is ready.)
- Re-detect on every Settings open, or cache for the session? (Leaning: detect once per Settings open — cheap, and catches newly installed terminals.)

---

<!-- Add item 4 below this line -->


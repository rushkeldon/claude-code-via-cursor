---
name: Mode picker — configurable, explicit-send, file-backed state (+ ccvc config rename)
overview: Make the prompt-pane mode pill a configurable menu whose items each send an explicit (visible) command; the pill reflects the real active mode read from the modes skill's active_modes.md (discovered from the CLI tool-call stream, cached, file-watched). Also rename the legacy claudeCodeChat.* config namespace to ccvc.* with a one-time auto-migration on activate.
todos:
  - id: config-rename
    content: "Rename all claudeCodeChat config usages → ccvc across package.json properties and the 7 src files"
    status: pending
  - id: config-migrate
    content: "Auto-migrate any existing claudeCodeChat.* settings → ccvc.* on activate (copy if new key unset)"
    status: pending
  - id: mode-settings
    content: "Add ccvc.modes.items setting (array of {id,label,command}) with Agent/Plan defaults; declare in package.json"
    status: pending
  - id: protocol-msg
    content: "Add setActiveMode (host→webview) message; push configured mode items via settingsData in src/webview/vscode.ts"
    status: pending
  - id: modes-helper
    content: "Create src/modes.ts: parse active_modes.md → active pill mode (agent/plan), read-on-demand + FileSystemWatcher"
    status: pending
  - id: path-cache
    content: "Cache discovered active_modes.md path in workspaceState (claude.activeModesPath)"
    status: pending
  - id: stream-sniff
    content: "In src/subprocess.ts tool_use parsing, capture any file_path ending in active_modes.md (any tool name) → cache+rescan"
    status: pending
  - id: startup-read
    content: "On activate, if cached path exists, read+parse+push active mode and start watching"
    status: pending
  - id: webview-render
    content: "Render menu from configured items; click sends the item's command explicitly (sendMessage); badge does NOT change optimistically"
    status: pending
  - id: version-bump
    content: "Bump appcloud9.X to the next version in package.json"
    status: pending
  - id: bbpi
    content: "Build, package (--no-dependencies), install VSIX with --force; reload and verify menu + pill reflect real mode"
    status: pending
isProject: false
---

# Mode picker — configurable, explicit-send, file-backed state (+ ccvc config rename)

## Background

The PromptPane mode pill (added in appcloud9.151) mirrors Cursor's mode picker: a pill
showing the selected mode — **Agent** (default) or **Plan** — opening a menu. The first cut
made each item a *prompt-injector* (drop `/modes …` into the input, don't send) and changed
the pill label **on click**. That desynced: the mode only actually changes when the command
is **sent** and the `modes` skill runs, so a click-then-backspace left the pill lying.

Two decisions resolve this:

1. **Explicit send, configurable items.** Clicking a menu item **sends its command
   explicitly** — a real, *visible* turn (not silent) via the normal `sendMessage` path.
   The menu items and the command each one sends are **user-configurable in settings**, so
   the user can repoint "Plan" at `/modes plan ./specs`, add new items, etc.
2. **File-backed pill.** The pill is **pure status**: it reflects the real active mode read
   from the `modes` skill's `active_modes.md`, never an optimistic guess. Clicking sends the
   command; the pill updates only when the file actually changes (via a watcher).

Separately, this codebase still uses the **predecessor project's config namespace**
`claudeCodeChat.*` (43 occurrences across 7 files + `package.json`). All occurrences are the
VS Code configuration namespace — `getConfiguration('claudeCodeChat')` reads plus the
`claudeCodeChat.*` property declarations. No command/view IDs are involved. We rename it to
**`ccvc`** and fold that in here, with a one-time migration so existing saved settings don't
silently orphan to defaults.

### active_modes.md format

```markdown
# Active modes

- plan: ./doc
```

Absent/empty (just the `# Active modes` header) = no modes active. `plan` and `agent` are a
mutex, so for the pill the active mode is exactly one of: `plan`, `agent`, or none → display
defaults to `agent`.

## Approach

### Part A — ccvc config rename (global)

- **Rename:** replace every `getConfiguration('claudeCodeChat')` →
  `getConfiguration('ccvc')` and rename the `claudeCodeChat.*` property keys in
  `package.json` `contributes.configuration.properties` → `ccvc.*`. The setting *suffixes*
  (`wsl.enabled`, `executable.path`, etc.) stay identical — only the namespace root changes.
- **Migrate:** the namespace is the key VS Code stores user settings under, so a bare rename
  silently resets existing config to defaults. On activate, run a one-time migration: for
  each known setting key, if `ccvc.<key>` is unset **and** `claudeCodeChat.<key>` has a value,
  copy it across (same `ConfigurationTarget` it was found in). Guard with a sentinel
  (`ccvc.migratedFromClaudeCodeChat: true`) so it runs once. Leave the old keys in place
  (harmless) or optionally clear them — do NOT delete on first pass to stay reversible.

Files with `claudeCodeChat`:
[src/terminalCommands.ts](src/terminalCommands.ts), [src/webview.ts](src/webview.ts),
[src/settings.ts](src/settings.ts), [src/extension.ts](src/extension.ts),
[src/permissions.ts](src/permissions.ts), [src/subprocess.ts](src/subprocess.ts),
[package.json](package.json).

### Part B — configurable, explicit-send menu

- New setting **`ccvc.modes.items`** — array of `{ id, label, command }`. Default:
  ```json
  [
    { "id": "agent", "label": "Agent", "command": "/modes agent" },
    { "id": "plan",  "label": "Plan",  "command": "/modes plan ./doc" }
  ]
  ```
  Declared in `package.json` with `type: array` (precedent: `ccvc.environment.variables` is a
  typed object setting). Icons stay code-side (the Glyphicons SVGs already inlined in
  PromptPane), keyed by `id` with a generic fallback for user-added ids.
- The host pushes `modes.items` to the webview alongside the existing `settingsData` message
  (see [src/webview/state/settings.ts](src/webview/state/settings.ts):96, the `settingsData`
  handler). The menu renders from that list.
- **Click → explicit send:** clicking an item calls the normal send path
  (`post({ type: 'sendMessage', text: item.command })` — same as
  [PromptPane.tsx](src/webview/components/PromptPane/PromptPane.tsx):196). It is a real,
  visible turn; the existing "processing" indicator covers the in-flight window. We do **not**
  inject-into-textarea and we do **not** change the pill label on click.

### Part C — file-backed pill state

Same mechanism as before: discover the `active_modes.md` path from the CLI's own tool-call
stream (zero derivation), cache it, then read + watch.

1. **On activate:** read cached `claude.activeModesPath` from `workspaceState`.
   - **Hit:** read+parse, push active mode to webview, start a `FileSystemWatcher`. No spawn,
     no model round-trip.
   - **Miss:** do nothing yet (subprocess is lazy — [subprocess.ts](src/subprocess.ts):36
     spawns on first turn). No eager spawn.
2. **Passive discovery:** in the `tool_use` stream parser, when any tool call's `file_path`
   ends in `active_modes.md`, cache the path, start watching, re-read + push. This naturally
   fires the first time a mode command runs.
3. **Steady state:** the watcher re-reads + re-pushes on every change — catching mode commands
   sent from the menu, typed `/modes` directly, cross-session state, and out-of-band edits.

This mirrors the two `FileSystemWatcher`s already in
[src/extension.ts](src/extension.ts):134-152 — same pattern + disposal discipline.

## Files to modify

- [package.json](package.json) — rename `claudeCodeChat.*` properties → `ccvc.*`; add
  `ccvc.modes.items` array setting; add `ccvc.migratedFromClaudeCodeChat` boolean (internal);
  bump `appcloud9.X` to the **next** version.
- [src/settings.ts](src/settings.ts) — `getConfiguration('ccvc')`; add the one-time migration
  helper; read `modes.items`; include it in the `settingsData` payload pushed to the webview.
- [src/extension.ts](src/extension.ts) — call the migration on activate; wire the
  startup modes-file read + watcher via new `modes.ts`; register watcher in
  `context.subscriptions` (parity with line 160-161).
- [src/terminalCommands.ts](src/terminalCommands.ts),
  [src/permissions.ts](src/permissions.ts),
  [src/webview.ts](src/webview.ts),
  [src/subprocess.ts](src/subprocess.ts) — `claudeCodeChat` → `ccvc` in all
  `getConfiguration` calls.
- [src/subprocess.ts](src/subprocess.ts) — in the `tool_use` block (~1412-1443), add a
  path-suffix check for `active_modes.md` for **any** tool name (do NOT gate on
  `Edit/MultiEdit/Write` like the existing line-1434 block — the skill mostly `Read`s the
  file). On match: cache path + trigger modes re-read.
- [src/modes.ts](src/modes.ts) — **new**: parse `active_modes.md`, derive pill mode, own the
  watcher, push `setActiveMode`.
- [src/webview/vscode.ts](src/webview/vscode.ts) — add `setActiveMode` to
  `MessageFromExtension` (~line 38); extend `settingsData` to carry `modes.items`.
- [src/webview/state/settings.ts](src/webview/state/settings.ts) — store `modes.items` from
  `settingsData`.
- [src/webview/components/PromptPane/PromptPane.tsx](src/webview/components/PromptPane/PromptPane.tsx)
  — render the menu from configured items; click → `sendMessage` with the item's command;
  subscribe to `setActiveMode` to set `selectedMode`; **remove** the optimistic
  `selectedMode.value = mode.id` on click; remove the now-unused inject-into-textarea path.

## Implementation details

### Migration (src/settings.ts)

```ts
// One-time: copy legacy claudeCodeChat.* values to ccvc.* so the namespace rename
// doesn't silently reset user config. Runs once, gated by a sentinel.
const KNOWN_KEYS = [
  'wsl.enabled','wsl.distro','wsl.nodePath','wsl.claudePath',
  'thinking.show','thinking.effort','permissions.yoloMode','executable.path',
  'environment.variables','environment.disabled',
  'terminal.useIntegrated','terminal.externalApp','terminal.customTemplate',
  'terminal.borderColor','terminal.fontColor','firstRun.hasShown',
];
async function migrateLegacyConfig() {
  const oldCfg = vscode.workspace.getConfiguration('claudeCodeChat');
  const newCfg = vscode.workspace.getConfiguration('ccvc');
  if (newCfg.get<boolean>('migratedFromClaudeCodeChat')) return;
  for (const key of KNOWN_KEYS) {
    const inspected = oldCfg.inspect(key);
    const oldVal = inspected?.workspaceValue ?? inspected?.globalValue;
    if (oldVal !== undefined && newCfg.get(key) === undefined) {
      const target = inspected?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      await newCfg.update(key, oldVal, target);
    }
  }
  await newCfg.update('migratedFromClaudeCodeChat', true, vscode.ConfigurationTarget.Global);
}
```

### Parsing active_modes.md → pill mode (src/modes.ts)

```ts
// plan↔agent is a mutex; pill shows 'plan' if a top-level `- plan` entry exists,
// else 'agent' (default stance). Missing/empty/unreadable file → 'agent'.
function pillModeFromFile(text: string): 'agent' | 'plan' {
  return /^\s*-\s*plan\b/m.test(text) ? 'plan' : 'agent';
}
```

### Menu render + explicit send (PromptPane.tsx)

```ts
// items come from settings (modeItems signal, fed by settingsData); icons keyed by id.
function selectMode(item: ModeItem) {
  setModeMenuOpen(false);
  post({ type: 'sendMessage', text: item.command }); // explicit, visible turn
  // NOTE: do not set selectedMode here — the pill updates from setActiveMode (file watch).
}
on('setActiveMode', (msg) => { selectedMode.value = msg.mode; });
```

### Watcher (mirrors extension.ts:134)

```ts
const watcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(vscode.Uri.file(path.dirname(p)), path.basename(p))
);
const reread = () => readAndPushActiveMode(p);
watcher.onDidChange(reread); watcher.onDidCreate(reread); watcher.onDidDelete(reread);
context.subscriptions.push(watcher);
```

## Edge cases

- **Click while a turn is in flight:** `sendMessage` already queues/handles this via the
  normal send path — no special-casing in the menu.
- **First session, cold cache, no /modes yet:** pill shows default `agent`; learns the real
  state the moment any mode command runs. No forced spawn.
- **File deleted / cleared:** `onDidDelete` / empty re-read → `agent`. Pill shows default.
- **User-added menu item with unknown id:** render a generic fallback icon; its `command` is
  whatever they configured. The pill only tracks `agent`/`plan` (mutex) — a custom item that
  doesn't change those won't move the pill, which is correct.
- **Migration idempotency:** sentinel `ccvc.migratedFromClaudeCodeChat` prevents re-running;
  per-key `get(key) === undefined` guard prevents clobbering anything already set under ccvc.
- **Settings live-reload:** if the user edits `ccvc.modes.items`, push fresh `settingsData`
  on the config-change event so the menu updates without reload (the host already listens for
  config changes).
- **Sniffer noise:** match strictly on `/(^|\/)active_modes\.md$/`.
- **Stale cached path:** read fails silently → `agent`; next `/modes` tool call re-discovers.

## What we are NOT doing

- **No silent send.** Rejected per decision — menu clicks are explicit, visible turns.
- **No optimistic pill label on click.** The pill is pure status from the file; this removes
  the desync hole entirely.
- **No edit to the `modes` skill / SKILL.md.** Path is discovered from the existing tool-call
  stream; no marker needed. (Editing SKILL.md would affect every project.)
- **No eager subprocess spawn / silent query at load** to learn the path — it's deterministic
  and cached from the stream.
- **No forward path-derivation** (encoding workspace path to `-Users-…`). Discovery-from-stream
  is exact and self-correcting.
- **No deletion of legacy claudeCodeChat.* keys** on first migration pass — copy only, stay
  reversible. A later cleanup can remove them.
- **No rename of command/view IDs** — none use the `claudeCodeChat` string; only the config
  namespace does.

## Open questions

- Collapse "no mode" → display as **Agent** (the documented default stance)? Plan assumes yes.
- Should `ccvc.modes.items` icons be configurable too (e.g. an `icon` field mapping to a known
  set), or stay code-side keyed by id? Plan keeps icons code-side with a fallback for now.
- After migration is proven, do we want a follow-up to delete the orphaned `claudeCodeChat.*`
  keys from the user's settings.json? (Out of scope here; copy-only for now.)

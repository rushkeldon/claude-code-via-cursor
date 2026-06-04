---
name: In-Webview Settings Dialog
overview: >
  Port the full settings dialog from the old monolithic HTML build into the new Preact webview.
  The gear button currently opens a stub modal that tells the user to go to VS Code settings;
  we replace it with the real settings UI (WSL config, permissions management, executable/env customization, yolo mode).
todos:
  - id: settings-state
    content: "Expand src/webview/state/settings.ts to hold the full settings payload (WSL, permissions, env vars, executable path) and wire up message listeners for settingsData and permissionsData"
    status: pending
  - id: settings-modal-ui
    content: "Rewrite SettingsModal.tsx with the full settings form: WSL section, Permissions section, Customize Claude Command section (executable path + env vars + yolo mode)"
    status: pending
  - id: settings-modal-less
    content: "Create SettingsModal.less with styles for settings groups, permission list, env variable rows, checkboxes, and form inputs"
    status: pending
  - id: vscode-types
    content: "Add settingsData, permissionsData, getSettings, updateSettings, getPermissions, removePermission, addPermission to the MessageToExtension/MessageFromExtension types in vscode.ts"
    status: pending
  - id: button-bar-request
    content: "Update ButtonBar toggleSettings to post getSettings + getPermissions messages when opening"
    status: pending
  - id: verify-build
    content: "Build the VSIX and install; verify settings dialog opens from gear icon and changes persist"
    status: pending
isProject: false
---

# In-Webview Settings Dialog

## Background

The old build had a full settings dialog rendered inline in the webview HTML (see `claude-code-chat/src/ui.ts` lines 294–428). It managed:

1. **WSL Configuration** — enable/disable, distro name, claude path, node path
2. **Permissions** — list of always-allow tool permissions with add/remove UI + yolo mode toggle
3. **Customize Claude Command** — executable path override, environment variables (key/value editor)

The extension host side (`src/settings.ts`, `src/permissions.ts`, and the message handler in `src/webview.ts`) is **already fully ported** — it handles `getSettings`, `updateSettings`, `getPermissions`, `addPermission`, and `removePermission`. The only missing piece is the webview UI.

Currently, the new `SettingsModal.tsx` is a stub that says "go to VS Code settings". We need to replace it with a real interactive form.

## Approach

Reuse the existing `Modal` component shell. Build the settings form as sections inside it. Use Preact signals to hold the settings state so the form is reactive. On open, post `getSettings` + `getPermissions`; on change, immediately post `updateSettings` (same pattern as old build). No new extension-host code needed — just webview UI and message types.

## Files to modify

- [src/webview/state/settings.ts](src/webview/state/settings.ts) — expand from minimal snapshot to full settings + permissions state
- [src/webview/components/SettingsModal/SettingsModal.tsx](src/webview/components/SettingsModal/SettingsModal.tsx) — full settings form
- src/webview/components/SettingsModal/SettingsModal.less — new file, styles for the dialog
- [src/webview/vscode.ts](src/webview/vscode.ts) — add message types
- [src/webview/components/ButtonBar/ButtonBar.tsx](src/webview/components/ButtonBar/ButtonBar.tsx) — post messages on settings open

## Implementation details

### State (`settings.ts`)

```ts
export interface FullSettings {
  'thinking.intensity': string;
  'wsl.enabled': boolean;
  'wsl.distro': string;
  'wsl.nodePath': string;
  'wsl.claudePath': string;
  'permissions.yoloMode': boolean;
  'executable.path': string;
  'environment.variables': Record<string, string>;
  'environment.disabled': boolean;
}

export interface PermissionsData {
  alwaysAllow: Record<string, boolean | string[]>;
}

export const fullSettings = signal<FullSettings | null>(null);
export const permissionsData = signal<PermissionsData>({ alwaysAllow: {} });
```

Register listeners via `on('settingsData', ...)` and `on('permissionsData', ...)`.

### SettingsModal sections

1. **WSL Configuration** — checkbox for enable, conditional sub-fields (distro, claude path, node path). Mirrors old build exactly.
2. **Permissions** — render `permissionsData.alwaysAllow` as a list (tool name + commands). Each entry has a remove button. "Add permission" form with tool select + optional command input. Yolo mode checkbox at bottom.
3. **Customize Claude Command** — text input for executable path, env variable key/value rows with add/remove.

Each section calls `post({ type: 'updateSettings', settings: {...} })` on change (debounced or on blur for text inputs, immediate for checkboxes).

### Message types to add

```ts
// MessageToExtension
| { type: 'getSettings' }
| { type: 'updateSettings'; settings: Record<string, any> }
| { type: 'getPermissions' }
| { type: 'addPermission'; toolName: string; command: string | null }
| { type: 'removePermission'; toolName: string; command: string | null }

// MessageFromExtension
| { type: 'settingsData'; data: FullSettings }
| { type: 'permissionsData'; data: PermissionsData }
```

### ButtonBar change

```tsx
function toggleSettings() {
  settingsModalVisible.value = !settingsModalVisible.value;
  if (settingsModalVisible.value) {
    post({ type: 'getSettings' } as any);
    post({ type: 'getPermissions' } as any);
  }
}
```

(The `as any` casts are temporary until the types are added to the union.)

## Edge cases

- **Empty env vars**: always render at least one empty row (matches old behavior)
- **Yolo mode**: when toggled on, show the warning banner (already exists as a separate component)
- **WSL section**: only relevant on Windows, but we show it unconditionally (matches old build — users can ignore if not on Windows)
- **Permissions file missing**: extension host already handles this gracefully, sends `{ alwaysAllow: {} }`

## What we are NOT doing

- **Model selector**: already has its own component (`ModelSelector`)
- **Thinking intensity modal**: already has its own component (`ThinkingPill`)
- **Custom snippets/slash commands**: already handled by `SlashCommands` component
- **OpenCredits/custom provider sections**: stripped from this fork
- **Support modal**: separate concern, not part of settings

## Open questions

- None — the extension host API is stable and the old UI is the reference implementation.

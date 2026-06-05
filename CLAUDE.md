# Claude Code via Cursor

VS Code/Cursor extension that wraps the Claude Code CLI in a Preact webview. One Claude Code subprocess instance per chat session.

## Architecture

- **Extension host** (`src/*.ts`) — manages the Claude Code subprocess, settings persistence, permissions, terminal commands
- **Webview** (`src/webview/`) — Preact UI rendered in the VS Code panel
- **Communication** — message passing between host and webview via `post()` / `on()` (typed in `src/webview/vscode.ts`)
- **Message routing** — extension host routes incoming messages in the `switch` statement in `src/webview.ts`

## Tech stack

- Preact + @preact/signals for reactive state
- Vite for webview bundling
- Less for styles
- TypeScript throughout

## Conventions

### Components
One folder per component: `src/webview/components/ComponentName/ComponentName.tsx` + `ComponentName.less`.

### State
Preact signals in `src/webview/state/`. Listeners registered via `on()` at module level so they activate on import.

### Styling
Use VS Code CSS variables (`--vscode-*`) for all colors and theming. No hardcoded color values.

### File naming
All lowercase with underscores as separators (snake_case). Put the general/common part of the name first (left), the specific differentiator last (right) — so files alphabetize by category. Exception: component folders follow PascalCase (`ComponentName/`) since that's idiomatic for Preact/React.

### Messages
`MessageToExtension` and `MessageFromExtension` union types in `src/webview/vscode.ts` define the protocol. Extension host handles them in the switch in `src/webview.ts`.

## Build & install

```bash
npm run compile                          # tsc + vite build
npx @vscode/vsce package --no-dependencies
cursor --install-extension <vsix> --force
```

Always bump `appcloud9.X` in `package.json` before packaging a new VSIX.

### Plans must not hard-code a version

Plan files (`*.plan.md`) must **never** name a specific version (e.g. "bump to appcloud9.73"). Always write "bump to the **next** version" instead. The number drifts — multiple agents bump `package.json` independently — so a hard-coded version in a plan goes stale and misleads. The version-bump todo reads the current `appcloud9.X` at execution time and increments it.

## Reference project

`../claude-code-chat` is the monolithic HTML predecessor. Use it as reference when porting features — the extension host code is largely shared, but the old webview was a single HTML blob with inline scripts.

# CCVC → IntelliJ IDEA Port: Readiness Audit

**Date:** 2026-06-10 · **Audited at:** `3.0.0-appcloud9.184` (commit `06b41af`) · **Scope:** read-only review of the repo's current state, assessed for portability to an IntelliJ Platform plugin.

## Verdict

**Webview-ready; host preserved via Node sidecar.** The Preact webview (~5,200 lines TSX/Less) ports nearly intact into a JCEF browser — its only VS Code couplings are one 98-line bridge file and 57 theme CSS variables. The extension host (~8,000 lines TS across `src/*.ts`) is Node + `vscode.*` API throughout, and IntelliJ plugins are JVM-side Kotlin/Java — so it either gets rewritten (Option A) or kept running verbatim as a bundled Node sidecar behind a thin Kotlin shell (Option B). **Option B is the chosen direction** (see Port-strategy options): the port is mandated one-to-one, and `subprocess.ts` (2,106 lines) encodes hard-won, verified stream-json control-protocol behavior with **zero automated test coverage** — the strongest possible argument for not rewriting it. The architecture's typed JSON message seam between host and webview makes the sidecar split clean.

## What the port reuses as-is

### 1. The webview (high reuse, ~95%)

- Plain web tech: Preact + signals, Vite-bundled to `out/webview/main.js` + `main.css`. JCEF (`JBCefBrowser`) hosts this directly; serve the bundle via a custom scheme/resource handler instead of `asWebviewUri`.
- **Only two VS Code couplings:**
  - `src/webview/vscode.ts` — the sole call to `acquireVsCodeApi()`. Swap `post()`/`on()` internals for a JCEF bridge (`JBCefJSQuery` inbound, `executeJavaScript` outbound). Every component already routes through this module; nothing else touches the VS Code webview API.
  - **57 distinct `--vscode-*` CSS variables** across the Less files. IntelliJ injects nothing; the plugin must generate these from the IDE Look-and-Feel (`JBColor`/`EditorColorsManager`) and re-inject on theme change. `doc/ref/css_var_report.md` already inventories every variable with fallbacks — a ready-made mapping spec.
- Minor: `CopyButton` uses `navigator.clipboard` with a postMessage fallback — the fallback path already handles JCEF's likely clipboard restrictions.

### 2. The protocol knowledge (the real asset)

- `doc/ref/control_protocol_surface.md` — authoritative, platform-neutral map of the CLI's stream-json control protocol (`initialize`, `set_model`, `interrupt`, `can_use_tool`, `set_permission_mode`, effort/thinking dials), verified against the live binary. This is the document that makes a JVM rewrite of `subprocess.ts` feasible without re-deriving behavior.
- The spawn contract is fully visible in `spawnProcess()` (subprocess.ts:531): `--output-format stream-json --input-format stream-json --include-partial-messages --verbose --permission-prompt-tool stdio`, plus `--resume`, `--model`, `--settings`, `--mcp-config` injection. All flag-level, no Node dependency.

### 3. Platform-neutral designs (rewrite, but 1:1)

These modules are file/JSON-based logic with no conceptual VS Code dependency — they translate mechanically to Kotlin:

| Module | Lines | Notes |
|---|---|---|
| `sessionLock.ts` | 201 | pid + heartbeat lockfiles under storage; pure `fs` |
| `conversation.ts` | 401 | JSON transcripts, atomic write-then-rename (uses `vscode.workspace.fs`, trivially → `java.nio`) |
| `claudeDownloader.ts` | 662 | npm-tarball + CDN fallback binary downloader; Node built-ins only → OkHttp/`HttpClient` + commons-compress |
| `logger.ts` | 202 | **zero** vscode imports; portable as a spec |
| `turnHealth.ts`, `sessionImages.ts`, `tokenCounters.ts`, `sessionTitle.ts`, `modes.ts`, `profile.ts` | ~600 | timers, file reads, JSON state |

### 4. Compliance guardrails (must carry over verbatim)

The CLAUDE.md guardrails (no auth surface, no credential handling, no headless `-p`/automation, restart ≠ login) are platform-independent policy, not VS Code code. They constrain the IntelliJ design identically — e.g. the port must also spawn the user's own locally-authenticated `claude` and keep all interaction per-turn human-initiated. `doc/ref/ccvc_compliance_and_terms.md` transfers unchanged.

## What the port must rewrite

### 1. Extension host → Kotlin (~8,000 lines)

All of `src/*.ts` is JVM-rewrite territory. Measured `vscode.*` API surface (by call count) and IntelliJ equivalents:

| VS Code API (uses) | IntelliJ equivalent |
|---|---|
| `workspace.getConfiguration` (26) + `contributes.configuration` (~20 settings) | `PersistentStateComponent` + a `Configurable` settings panel — **the settings schema/UI is free in VS Code, hand-built in IDEA** |
| `workspace.fs.*` (44) | `java.nio` / VFS |
| `Memento` workspace/global state (11) | `PropertiesComponent` / project- and app-level `PersistentStateComponent` |
| `window.createTerminal` (8) | Terminal plugin (`TerminalToolWindowManager`) — adds a plugin dependency |
| `createFileSystemWatcher` (3 — `~/.claude/settings.json`, `.claude/settings.local.json`, modes file) | VFS listeners only cover project roots; home-dir watching needs `java.nio.WatchService` |
| Webview panel + sidebar `WebviewViewProvider` | `ToolWindowFactory` + JCEF; the dual panel/sidebar mode collapses into tool-window placement |
| `vscode.diff` + `TextDocumentContentProvider` (`claude-diff` scheme) | `DiffManager` + `DiffContent` (arguably easier in IDEA) |
| `openTextDocument`/`showTextDocument`, `showOpenDialog`, clipboard, `env.openExternal`, status bar, notifications | `FileEditorManager`, `FileChooser`, `CopyPasteManager`, `BrowserUtil`, `StatusBarWidget`, `Notifications` — all routine |

`package.json` contributes (command, keybinding `cmd+shift+C`, 9 menu locations, activity-bar view) map to `plugin.xml` actions/tool-window declarations — mechanical.

### 2. Process management (the hard 20%)

`subprocess.ts` is the heart: spawn, AbortController, queued-prompt turn loop, silent queries, control-request correlation, `processJsonStreamData` (~450 lines of stream parsing), settings-triggered graceful respawn, and three-way process-group kill (`process.kill(-pid)` POSIX / `taskkill /t /f` Win / `wsl pkill`). JVM notes:

- `ProcessBuilder` can't `setpgid`; use `ProcessHandle.descendants()` for tree-kill, or shell out to the same `taskkill`/`pkill` commands the TS already uses.
- Stream-json line parsing + control-request/response correlation (`sendControlRequest`, pending-map, wait timers in `armWaitTimers`) must be re-implemented carefully — this is where the test gap bites (see Risks).
- WSL mode (path translation `convertToWSLPath`, `wsl.exe -d <distro> bash -ic ...`) should likely be **rebuilt on IntelliJ's own WSL APIs** (`com.intellij.execution.wsl`) rather than ported literally.

### 3. Editor-adjacent UX

`launchSlashCommand`'s terminal dispatch supports 10 terminal targets (integrated, iTerm, kitty, WezTerm, Ghostty, Warp, Alacritty, Hyper, Rio, Terminal.app) with per-app launch templates — portable logic, but the "integrated" path changes APIs. Drag-and-drop URIs into the webview, image attach/preview (`IMAGE_MEDIA_TYPES`, thumbnail URIs via webview URIs), and `openFile`/`openDiff` round-trips all need JCEF-side re-plumbing (no `asWebviewUri`; use the custom scheme handler or `data:` URIs).

## Gaps to close before porting (in the current repo)

These are pre-port investments that pay off regardless of the port:

1. **The typed message protocol is incomplete — make it authoritative.** `MessageToExtension` in `src/webview/vscode.ts` declares 32 inbound types, but the dispatch switch in `src/webview.ts` handles **~84** (94 cases minus 10 terminal-name cases). Untyped-but-handled: `getConversationList`, `deleteConversation`, `loadConversation`, `getWorkspaceFiles`, `openFile`, `openDiff`/`openDiffByIndex`, `openExternalUrl`, the whole skills/plugins/MCP suite (`loadSkills`, `saveSkill`, `installPlugin`, `marketplaceFetch`, …), snippets, env-var management, and more. The Kotlin host must implement every one; today the union type would silently under-specify the contract by more than half. Closing this gap (and ideally generating a JSON-schema or shared spec from it) is the single highest-leverage pre-port task.
2. **No automated tests exist.** `package.json` defines `test:downloader` scripts pointing at `out/test/downloader*.test.js`, but there is no `src/test/` and no `*.test.*` source anywhere — the scripts are stale. The port has no regression net for the riskiest code (stream parsing, error classification in `classifyApiError`, turn lifecycle, lockfile staleness). Recommend characterization tests against `processJsonStreamData` using recorded stream-json transcripts; those fixtures then validate the Kotlin parser too.
3. **Host modules touch `vscode.*` directly despite the DI pattern.** Every module takes an `init({ postMessage, … })` deps object (good — `extension.ts` shows clean wiring), but then most also import `vscode` directly for config/fs/UI. Widening the deps interfaces to cover config-read, fs, and notifications would make each module a direct translation target — and would let the TS source act as the executable spec during the port.
4. **Minor hygiene:** 8 stale `.vsix` artifacts (~950 KB each) and `out/` sit in the working tree (gitignored, so cosmetic); `doc/modes_session_scoped_state.md` rename and a stray `doc/archive/session_scoped_modes.plan.md` are uncommitted; `probe_thinking.mjs` is an unhomed root-level script (candidate for `doc/ref` or a `tools/` dir).

## Port-strategy options

**A. Full Kotlin rewrite.** Webview reused via JCEF; host re-implemented against the (completed) message protocol + `control_protocol_surface.md`. Rough shape: protocol/JCEF bridge and theme shim ~1–2 weeks; portable modules ~2 weeks; subprocess/turn-loop/permissions ~3–4 weeks including fixtures; settings UI, terminals, diff/editor glue ~2 weeks. ~2–2.5 engineer-months to parity, dominated by `subprocess.ts` + `webview.ts` handler re-implementation. Its central risk is re-deriving `subprocess.ts` behavior with no regression net — it is only a responsible choice *after* the characterization tests in "Gaps" item 2 exist.

**B. Node sidecar (recommended).** Keep `src/*.ts` host logic running verbatim as a standalone Node process; the IntelliJ plugin becomes a Kotlin shell: JCEF webview + sidecar supervisor + a small IDE-services RPC. The decisive advantage under the one-to-one mandate: the 2,106 untested lines of `subprocess.ts` — the code that embodies the verified stream-json knowledge — **never get rewritten**. The exact behavior shipping today keeps shipping.

The RPC surface is smaller than it first appears. Of the host's `vscode.*` usage:

- **Stays in Node, no RPC:** all `workspace.fs` calls (44 — plain `fs` works), `Memento` state and `getConfiguration` reads (move to sidecar-owned JSON files; the Kotlin settings panel writes the same files), file watchers (`fs.watch`/chokidar), and the entire subprocess/lock/conversation/downloader machinery.
- **Needs JVM RPC (~15–20 small calls):** open file, open diff, file-picker dialogs, integrated-terminal launch, clipboard, notifications/info messages, open-external-URL, status-bar state, and theme-variable push to the webview.
- **Webview path:** already postMessage — the JCEF bridge relays webview ⇄ sidecar messages with the Kotlin shell as a dumb pipe.

Costs, honestly: bundled Node runtime (~50 MB per platform; precedented — GitHub Copilot's JetBrains plugin ships a Node sidecar), supervising one more process (spawn/restart/crash detection — patterns the codebase already has for the CLI itself), and permanently maintaining a TS host inside a JetBrains plugin. Compliance posture is unchanged: the sidecar is the same code spawning the same user-authenticated CLI; nothing new touches auth or routing.

**Recommendation: B**, given the one-to-one mandate and the absence of tests. The decision criterion, explicitly: **if the characterization-test fixtures (Gaps item 2) get built anyway, A becomes competitive** — a tested Kotlin port is the better long-term fit (one runtime, one language, no bundled Node). Without those fixtures, rewriting `subprocess.ts` is the riskiest possible move, and B avoids it entirely. Either way, fixing the protocol typing (Gaps item 1) comes first — under B it becomes the contract for the JCEF relay and the IDE-services RPC.

## Non-goals

**ACP (Agent Client Protocol) — considered and rejected (2026-06-10).** JetBrains supports ACP, and Claude Code can speak it via an adapter, so it looks like a shortcut past the host rewrite. It isn't, for this project: ACP is a different contract (JSON-RPC, its own session model, content-block shapes, generic `request_permission`) and would put a translation layer between CCVC and the stream-json control surface it actually depends on — `--permission-prompt-tool stdio` / `can_use_tool`, `set_model`, `interrupt`, `get_settings`, effort/thinking dials, `--resume` semantics, partial-message streaming. That surface is verified end-to-end against the live binary in `doc/ref/control_protocol_surface.md`; the subtler behaviors (queue/interrupt timing, error classification off the raw stream, settings-triggered respawn) don't necessarily survive translation. The port is one-to-one: spawn the same binary with the same flags, speak the same stream-json. Do not re-litigate ACP without a concrete forcing reason.

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Stream-json parser regressions (no tests) | **High** | Recorded-transcript fixtures before porting; reuse for Kotlin |
| Protocol under-specification (~50 untyped message types) | **High** | Complete the unions; generate a shared spec |
| Theme fidelity (57 CSS vars, light/dark/high-contrast, live theme switch) | Medium | `css_var_report.md` mapping + LaF listener; accept approximation initially |
| Process-tree kill / WSL on JVM | Medium | `ProcessHandle` descendants + existing shell fallbacks; IntelliJ WSL API |
| CLI protocol drift (subtype unions grow per release) | Medium | Same risk as today; keep `control_protocol_surface.md` current |
| Terminal plugin dependency / external-terminal matrix | Low | Feature-flag external terminals at first |

## Bottom line

The repo is in good shape to *start* a port: clean message-passing seam, documented control protocol, DI-style host modules, and a fully reusable web UI. The chosen direction is a **one-to-one port via Node sidecar (Option B)**: the verified stream-json host code keeps running unmodified, the Kotlin shell stays thin, and nothing hard-won gets re-derived. First step either way is completing the message-protocol typing; characterization tests for `processJsonStreamData` remain the lever that would make a future full-Kotlin rewrite (Option A) safe, if one is ever wanted.

---
name: CCVI — Claude Code via IntelliJ (plugin port of CCVC)
overview: Port the CCVC experience to an IntelliJ IDEA plugin (CCVI) using a Node sidecar for the host and JCEF to re-host the existing Preact webview, plus a native plan tool window that renders/updates *.plan.md todos live (the feature Cursor exposes only through a watched directory). Phased so each phase ends at a runnable, demoable state. Built in a NEW CCVI repo with this CCVC repo checked out alongside as a read-only reference/resource.
todos:
  - id: p0-spike-jcef
    phase: "Phase 0 — De-risk spikes"
    content: "Phase 0 — JCEF spike: bare IntelliJ plugin with a tool window hosting a hello-world HTML in JBCefBrowser; one JS→JVM round-trip via JBCefJSQuery"
    status: pending
  - id: p0-spike-sidecar
    phase: "Phase 0 — De-risk spikes"
    content: "Phase 0 — sidecar spike: spawn a trivial Node script from Kotlin via ProcessHandler, exchange one newline-delimited JSON message each way"
    status: pending
  - id: p1-repo-scaffold
    phase: "Phase 1 — Repo scaffold + UI transport"
    content: "Phase 1 — scaffold CCVI repo: Gradle + IntelliJ Platform Gradle Plugin, Kotlin, plugin.xml, runIde task; CCVC checked out as a sibling resource"
    status: pending
  - id: p1-bundle-build
    phase: "Phase 1 — Repo scaffold + UI transport"
    content: "Phase 1 — build pipeline that produces the Preact bundle (reuse CCVC webview) and packages it into the plugin resources"
    status: pending
  - id: p1-bridge-layer
    phase: "Phase 1 — Repo scaffold + UI transport"
    content: "Phase 1 — implement the JCEF transport: a drop-in replacement for src/webview/vscode.ts's post()/on() backed by JBCefJSQuery + executeJavaScript"
    status: pending
  - id: p2-sidecar-host
    phase: "Phase 2 — Sidecar host"
    content: "Phase 2 — extract/adapt the CCVC TS host to run as a standalone Node sidecar exposing the same MessageToExtension/MessageFromExtension protocol over stdio"
    status: pending
  - id: p2-process-mgmt
    phase: "Phase 2 — Sidecar host"
    content: "Phase 2 — Kotlin ProcessHandler manages the sidecar lifecycle (spawn, restart, dispose) and pumps messages between sidecar stdio and the JCEF bridge"
    status: pending
  - id: p2-settings-bridge
    phase: "Phase 2 — Sidecar host"
    content: "Phase 2 — map CCVC settings to IntelliJ PersistentStateComponent; feed them to the sidecar (no claudeCodeChat/ccvc VS Code config namespace on JVM)"
    status: pending
  - id: p3-theme-shim
    phase: "Phase 3 — Theming + first real turn"
    content: "Phase 3 — theme bridge: inject IntelliJ JBColor/LAF colors as --vscode-* CSS custom properties so the reused webview themes to the active IDE theme"
    status: pending
  - id: p3-end-to-end
    phase: "Phase 3 — Theming + first real turn"
    content: "Phase 3 — first full chat turn end-to-end inside IntelliJ: type → sidecar → claude → stream renders in the JCEF chat"
    status: pending
  - id: p4-plan-toolwindow
    phase: "Phase 4 — Native plan rendering"
    content: "Phase 4 — native plan tool window: parse a *.plan.md, render its todos (grouped by optional `phase` attribute — see Plan schema section), update status live as the agent works (in-memory, no watched dir)"
    status: pending
  - id: p4-modes-plan2x
    phase: "Phase 4 — Native plan rendering"
    content: "Phase 4 — wire the modes/plan2cursor equivalent: mode picker drives /modes; plans surface in the native panel instead of ~/.cursor/plans"
    status: pending
  - id: p4-history-scan
    phase: "Phase 4 — Native plan rendering"
    content: "Phase 4 — scan-as-truth history: list sessions by scanning ~/.claude/projects/<encoded-cwd>/*.jsonl (the PROJECT's sessions, like Claude's /resume picker — forks + terminal + extension sessions), cheap per-row header (title/mtime/gitBranch/size); enrich-by-id from the CCVC-style record when present. Sidecar reads the dir directly (no programmatic list command exists). See 'History model' section."
    status: pending
  - id: p4-rehydrator
    phase: "Phase 4 — Native plan rendering"
    content: "Phase 4 — .jsonl rehydrator: translate raw stream-json (user/assistant/tool_use/tool_result/thinking/attachment) into CCVC webview message[] and replay via the existing loadConversationHistory path. Enables continuing a terminal-started session in the UI. Fiddly bits: tool_use↔tool_result pairing by id, cost/token recompute from usage, title derivation. See 'History model' + rehydration analysis."
    status: pending
  - id: skill-modes-phases
    content: "Update the modes skill: teach it the optional `phase` todo attribute — when to use phases (multi-stage plans) and how to author them (add `phase:` to grouped todos; ordinal by first appearance; backward-compatible)"
    status: pending
  - id: p5-parity-audit
    phase: "Phase 5 — Parity, compliance, distribution"
    content: "Phase 5 — feature-parity audit against CCVC (checkpoints, history, queue, permissions, images, breakout terminal); punch-list the gaps"
    status: pending
  - id: p5-compliance
    phase: "Phase 5 — Parity, compliance, distribution"
    content: "Phase 5 — carry over the thin-launcher compliance posture; confirm no auth surface, no credential handling, human-in-the-loop"
    status: pending
  - id: p5-product-identity
    phase: "Phase 5 — Parity, compliance, distribution"
    content: "Phase 5 — rebrand product-identity strings CCVC → CCVI for the port. Notably the backup-repo commit author (src/backupRepo.ts: name 'CCVC', email 'ccvc@appcloud9.com' → 'CCVI'/'ccvi@appcloud9.com'). RECOMMENDATION: source the author from a single product-identity constant (extension name/id) rather than a bare literal, so the port flips one value instead of hunting scattered strings. Audit for other hardcoded 'CCVC' user-facing strings (status-bar tooltip, package metadata)."
    status: pending
  - id: p5-distribution
    phase: "Phase 5 — Parity, compliance, distribution"
    content: "Phase 5 — packaging/distribution: buildPlugin zip, local install, decide on JetBrains Marketplace vs personal-only"
    status: pending
isProject: false
---

# CCVI — Claude Code via IntelliJ (plugin port of CCVC)

## Background

CCVC ([this repo](.)) wraps the Claude Code CLI in a Cursor/VS Code extension:
a Node **extension host** (`src/*.ts`) that spawns one `claude` subprocess per
session and speaks its `stream-json` protocol, plus a **Preact webview**
(`src/webview/`) for the UI. The user wants the same experience as a native
**IntelliJ IDEA plugin** ("CCVI" — Claude Code via IntelliJ), and crucially also
wants the **Cursor-style plan rendering/updating in the editor** — but native,
since IntelliJ has no built-in plans panel.

Two architectural decisions are already made:

- **Host = Node sidecar.** The plugin spawns the existing CCVC TS host as a child
  Node process and talks to it, rather than rewriting the host in Kotlin. This
  reuses the hardest, most battle-tested code (subprocess mgmt, `stream-json`
  parsing, turn-health, dropped-turn recovery) instead of reimplementing it.
- **UI = JCEF, reuse the bundle.** IntelliJ bundles JCEF (embedded Chromium). The
  existing Preact/Vite bundle loads into a JCEF tool window; only the VS Code
  message layer is swapped for a JCEF JS↔JVM bridge.

**Execution context:** this work happens in a **new `CCVI` repo**. This `CCVC`
repo is checked out alongside it as a **read-only reference/resource** — the
plugin reuses CCVC's webview source and host source, so keep CCVC available at a
known sibling path during the build (e.g. `../claude-code-via-cursor`). This plan
file lives in CCVC's `doc/` but describes work performed in the CCVI repo.

## The key insight that makes this feasible

The entire VS Code coupling of the UI is one file:
[src/webview/vscode.ts](src/webview/vscode.ts). It does exactly three things:

- `const vscode = acquireVsCodeApi()` + `post(msg) => vscode.postMessage(msg)`
- `window.addEventListener('message', …)` to receive
- typed `MessageToExtension` / `MessageFromExtension` unions defining the protocol

Everything else in `src/webview/` is platform-agnostic Preact. So the port's UI
work is: **provide a `vscode.ts`-shaped module backed by the JCEF bridge**, and
the rest of the webview compiles unchanged. The `MessageToExtension` /
`MessageFromExtension` unions become the **stable contract** shared by all three
layers (webview ↔ plugin ↔ sidecar).

Symmetrically, the host's coupling to VS Code is its `postMessage` to the webview
and its message switch in [src/webview.ts](src/webview.ts). The sidecar keeps the
same protocol but moves the transport from VS Code's webview channel to stdio.

## Architecture

```
┌─────────────────────────── IntelliJ IDEA (JVM plugin: CCVI) ──────────────────────────┐
│                                                                                         │
│  Tool window (JCEF) ──── JBCefJSQuery / executeJavaScript ────┐                         │
│   • reused Preact bundle from CCVC src/webview               │  (MessageTo/FromExtension│
│   • vscode.ts replaced by jcefBridge.ts                       │   JSON, same contract)   │
│                                                               ▼                         │
│  Kotlin glue: ToolWindowFactory, JBCefBrowser, theme shim,  ProcessHandler              │
│  PersistentStateComponent (settings), native Plan tool window                           │
│                                                               │                         │
└───────────────────────────────────────────────────────────────┼─────────────────────────┘
                                                                  │ newline-delimited JSON
                                                                  ▼ over stdio
                                          ┌──────────── Node sidecar (CCVC host) ──────────┐
                                          │  spawns + speaks stream-json to:               │
                                          └──────────────────────┬─────────────────────────┘
                                                                 ▼
                                                          `claude` CLI subprocess
```

Two message hops, one protocol:
1. **Webview ↔ Plugin** — JCEF bridge (replaces VS Code `postMessage`).
2. **Plugin ↔ Sidecar** — stdio newline-delimited JSON (replaces VS Code webview→host call).
The plugin is mostly a **dumb pump** between these two hops, plus native UI (plan panel, theme, settings).

## Phases

### Phase 0 — De-risk spikes (prove the two unknowns)

Smallest possible code to validate the two load-bearing assumptions before
committing to the scaffold. Two independent spikes:

- **JCEF spike** (`p0-spike-jcef`): a bare plugin with a `ToolWindowFactory` that
  shows a `JBCefBrowser` loading hello-world HTML, and one button that calls back
  into Kotlin via `JBCefJSQuery` (and Kotlin pushes one message back via
  `executeJavaScript`). Confirms: JCEF is present in the target IDE, the bridge
  round-trips, lifecycle/dispose is sane.
- **Sidecar spike** (`p0-spike-sidecar`): Kotlin spawns a trivial Node script via
  `ProcessHandler`/`GeneralCommandLine`, writes one JSON line to its stdin, reads
  one JSON line from stdout. Confirms: process mgmt + stdio framing works on the JVM.

Exit criteria: both round-trips demonstrably work. If JCEF is absent/broken on the
target IDE, STOP and reconsider (Swing fallback) before Phase 1.

### Phase 1 — Repo scaffold + UI transport

- `p1-repo-scaffold`: new CCVI repo. Gradle + **IntelliJ Platform Gradle Plugin**,
  Kotlin, `plugin.xml` (tool window registration), working `runIde`. CCVC checked
  out as a sibling for source reuse.
- `p1-bundle-build`: a build step that produces the Preact bundle from CCVC's
  `src/webview` (reuse the Vite config as a base — [vite.config.ts](vite.config.ts))
  and copies the output into the plugin's resources so JCEF can load it. Decide:
  git submodule of CCVC vs. vendored copy vs. published npm package of the webview.
- `p1-bridge-layer`: implement `jcefBridge.ts` — a module with the **same exported
  surface as** [src/webview/vscode.ts](src/webview/vscode.ts) (`post()`, `on()`,
  the unions) but backed by `window.cefQuery` (→ JVM) and a JVM→JS injection point.
  The webview imports it instead of `vscode.ts` (build alias / path swap).

Exit: the reused Preact UI renders inside an IntelliJ tool window and can send/receive
test messages through the bridge (not yet wired to a real sidecar).

### Phase 2 — Sidecar host

- `p2-sidecar-host`: adapt the CCVC TS host to run headless as a Node process. Most
  of `src/*.ts` is already pure Node; the VS Code couplings to sever/adapt are:
  `vscode.workspace`/`getConfiguration` (→ injected settings from the plugin),
  `vscode.window`/UI calls, `FileSystemWatcher` (→ node `fs.watch` or chokidar),
  and the webview `postMessage` (→ stdout JSON). Keep the
  `MessageToExtension`/`MessageFromExtension` protocol identical. Reference modules:
  [src/subprocess.ts](src/subprocess.ts), [src/webview.ts](src/webview.ts) (the
  message switch), [src/settings.ts](src/settings.ts), [src/modes.ts](src/modes.ts).
- `p2-process-mgmt`: Kotlin `ProcessHandler` owns the sidecar — spawn on tool-window
  open, restart control (parity with CCVC respawn — **restart only**, never login),
  dispose on close. Pump: sidecar stdout line → JCEF `executeJavaScript`; JCEF
  `cefQuery` → sidecar stdin line.
- `p2-settings-bridge`: replace the VS Code `ccvc.*` configuration namespace with
  IntelliJ `PersistentStateComponent`. The plugin reads its settings and passes
  them to the sidecar at spawn (model, executable path, env, terminal prefs, mode
  items). No VS Code config API on the JVM side.

Exit: the sidecar runs under the plugin; messages flow webview ↔ plugin ↔ sidecar.

### Phase 3 — Theming + first real turn

- `p3-theme-shim`: CCVC's webview styles everything via `--vscode-*` CSS variables
  ([CLAUDE.md](CLAUDE.md) styling convention). On IntelliJ those don't exist —
  build a shim that reads the active IDE theme (`JBColor`/`UIManager` keys) and
  injects them as `--vscode-*` custom properties into the JCEF document, refreshing
  on theme change (`LafManagerListener`). This is what makes the reused UI look
  native instead of alien.
- `p3-end-to-end`: full chat turn inside IntelliJ — type a message → bridge →
  sidecar → `claude` → `stream-json` → render in the JCEF chat with tool cards.
  This is the "it's alive" milestone.

Exit: a real Claude turn works end-to-end in IntelliJ, themed to the IDE.

### Phase 4 — Native plan rendering (the differentiator)

This is the feature the user specifically wants and the place CCVI can **beat**
Cursor. Cursor only exposes plans via a watched `~/.cursor/plans/` directory (hence
CCVC's file-copy + watcher + UUID-surgical-status-edit dance — see the
[modes](doc/archive/mode_state.plan.md) work). IntelliJ has no such panel, so we
build and **own** it — meaning live updates are direct in-memory renders, no
watched-dir fragility.

- `p4-plan-toolwindow`: a second tool window (or split) that parses a `*.plan.md`
  (the Cursor-compatible frontmatter: `name`, `overview`, `todos[]` with
  `status` ∈ pending/in_progress/completed/cancelled) and renders the todo list
  with live status (spinner/check/strikethrough). **Renders phase groupings** when
  todos carry the optional `phase` attribute (see "Plan schema extension: phases"
  below) — phase headers with their child todos nested beneath, and ideally a
  per-phase progress roll-up. Updates pushed from the sidecar/agent as work
  progresses — rendered directly, not via a file the panel re-parses. Clicking a
  todo can jump to referenced files.
- `p4-modes-plan2x`: wire the mode picker (built in CCVC's appcloud9.151–154) to
  drive `/modes`, and route produced plans into the native panel instead of
  `~/.cursor/plans/`. The `plan2cursor` skill's whole reason for existing
  (feeding Cursor's closed panel) collapses into "render it ourselves."

Exit: an agent plan renders in the native panel and ticks off todos live as work lands.

#### Plan schema extension: phases (the place CCVI's renderer beats Cursor's)

The native panel is ours, so we can render a richer plan than Cursor's flat
checklist while staying **100% backward-compatible** with the existing schema.

The extension is a single **optional `phase` attribute on each todo**:

```yaml
todos:
  - id: p0-spike-jcef
    phase: "Phase 0 — De-risk spikes"
    content: "..."
    status: pending
  - id: p0-spike-sidecar
    phase: "Phase 0 — De-risk spikes"
    content: "..."
    status: pending
  - id: p1-repo-scaffold
    phase: "Phase 1 — Scaffold"
    content: "..."
    status: pending
```

Rendering rules:

- **Presence of `phase` triggers grouping.** If *any* todo has a `phase`, the
  renderer groups todos under phase headers. If *no* todo has one, it renders the
  existing flat list (unchanged).
- **Phases are ordinal by first appearance.** The todos array order is already
  meaningful; a phase's position is fixed by the first todo that names it. No
  separate phase-ordering field — derive it from array order. (Do NOT sort phases
  alphabetically.)
- **Todos within a phase keep array order** (their relative order in the array).
- **Mixed plans degrade gracefully.** A todo with no `phase` while others have one
  renders in an implicit "ungrouped" bucket (rendered first, before the first
  named phase, or last — pick one and be consistent; leaning "in array order,"
  i.e. wherever the ungrouped todos fall relative to phased ones).
- **Backward compatibility is structural.** `phase` is an unknown field to
  Cursor's renderer, which ignores it and shows the flat checklist. Stable UUIDs,
  the `status` vocabulary, and the surgical status-edit protocol are all
  unchanged — `phase` is a *grouping label*, never structural nesting. The array
  stays flat; we never nest todos inside a phase object.
- **Per-phase progress (nice-to-have):** the header can show `2/5` completed or a
  small bar, computed from its children's statuses.

This mirrors the vocabulary the **Workflow** tooling already uses (`meta.phases`
of `{title, detail}` plus a per-step `phase:` label over a flat work list), so the
plan schema and the workflow runner speak the same "phase as a grouping key"
language.

The **`skill-modes-phases`** todo carries the other half: teaching the modes skill
(which authors `*.plan.md` files in plan mode) when to emit phases and how to
write them, so authored plans actually use the attribute the renderer supports.

#### Divergence: the sidecar owns child stdio (fork & session visibility)

A structural difference between CCVC and CCVI, worth calling out because it's an
opportunity, not just a parity gap:

**In CCVC, forked sessions are invisible to the history panel** — by design, as a
side effect of two facts:

- CCVC's history is a **private index** (`conversationIndex` in VS Code
  `workspaceState` under `claude.conversationIndex`, backed by CCVC's own
  `conversations/*.json`), **not** a scan of Claude Code's `~/.claude/projects/
  <proj>/*.jsonl` transcripts. It only gains entries when CCVC *itself* runs a turn
  and hits its save path.
- A fork (`--resume <id> --fork-session`, see CCVC's `forkSessionToTerminal` /
  `launchSlashCommand` in `src/webview.ts`) opens a **detached terminal** running
  `claude`. CCVC spawns it but never reads its stdout. The fork writes its own
  `.jsonl` transcript under `~/.claude/projects/`, which CCVC never indexes — so it
  never appears in CCVC's history (it *is* visible to the native `claude --resume`
  CLI history, a separate namespace).

**In CCVI this can be different — and should be a deliberate decision, not an
inherited blind spot.** The Node sidecar **owns the child's stdio** (that's the
whole architecture: Plugin ↔ Sidecar over stdio). So a CCVI fork need not be a
detached terminal at all — the sidecar can spawn the forked `claude`, read its
stream, capture its newly-minted session id on the first turn, and **index forks
into a unified history / session tree** that CCVC structurally cannot build. This
pairs with the session-scoped modes work (see
[doc/modes_session_scoped_state.plan.md](../modes_session_scoped_state.plan.md)):
that plan's fork-inheritance "lineage card" rides in as the fork's positional
prompt precisely because CCVC *can't* capture the child id; CCVI's sidecar **can**,
so CCVI could additionally surface the child id, parent lineage, and active modes in
the UI (e.g. the FORKED card upgrading from "forked to your terminal" → "forked →
session `XYZ`", or a clickable child in a session tree).

Note this is independent of the modes-file garbage collection in that plan: the GC
sweep keys off **transcript existence** (`<proj>/<id>.jsonl`), not any history
index, so it stays correct regardless of whether a fork is surfaced in history.

Decision for CCVI (defer to `p5-parity-audit` / a Phase 4 session-model spike):
match CCVC (forks stay terminal-detached, invisible) for fastest parity, or lean
into the sidecar and make fork visibility + a session tree a CCVI differentiator.
Leaning toward the latter, since "own the session model" is the same instinct that
makes the native plan panel worth building.

#### History model: scan-as-truth + enrich-by-id (the project's sessions, not the extension's)

This follows directly from the divergence above, and it's a **philosophy
consequence, not just a feature choice.** CCVC's posture is a thin window onto the
user's own `claude`. But its history panel shows a strict **subset** of what
`claude` itself can surface — only sessions CCVC drove turns through — which quietly
violates that posture: it makes CCVC a walled garden over a subset of the user's own
conversations.

The evidence is concrete. Claude Code's native `/resume` picker (and bare
`--resume`) lists **every** `.jsonl` in `~/.claude/projects/<encoded-cwd>/` — title,
relative time, `gitBranch`, and size per row — with branch filter, fuzzy search, and
preview. Verified: it surfaces never-forked CCVC sessions (including the live one),
forks, *and* terminal-launched sessions alike. It is a directory scan. CCVC's panel
is a strict subset of it; there is nothing CCVC shows that the picker lacks (modulo
CCVC's enriched metadata, which the picker doesn't display but the `.jsonl` still
contains).

**The principle:** *if Claude Code can surface every conversation in a project, so
should we.* The motivating workflow the subset model makes impossible today:
**"started a session in the Claude Code terminal, now want to continue it in the
extension"** — natural for a tool that wraps `claude`, and free under scan-as-truth.

**The model** (for CCVI; a possible CCVC retrofit, see caveat):

```
AUTHORITATIVE: scan ~/.claude/projects/<encoded-cwd>/*.jsonl
  → the session list = the PROJECT's sessions (forks, terminal-launched,
    never-forked extension sessions — all of it). Stateless: survives
    workspaceState loss / reinstall, because it reconstructs from disk.
  → cheap per-row header read: title (ai-title line / first user msg),
    mtime, gitBranch, file size, line count.

ENRICHMENT (left-join by session id):
  → IF a CCVC-style record exists for this id → use its title/cost/tokens/
    pre-rendered cards (fast, rich).
  → ELSE → rehydrate from .jsonl on select (the rehydrator: stream-json →
    webview message[] → existing replay path, reusing loadConversationHistory).
```

So the private per-session store is **demoted from source-of-truth to an optional
enrichment cache keyed by session id** — not deleted. Nearly everything it holds is
reconstructable from the `.jsonl` (title, branch, counts, cost/tokens from usage
blocks, rendered cards via the rehydrator), so it's a performance/UX cache, not a
system of record.

**Caveat — what the cache still genuinely owns:** CCVC-only augmentation not present
in the transcript, chiefly **checkpoint/restore** ([src/backupRepo.ts](src/backupRepo.ts)),
which ties git backup commits to conversation messages. A session rehydrated purely
from `.jsonl` (a fork, a terminal session) has **no checkpoints** — viewable and
resumable, but "restore to this point" won't exist for it. That's honest (those
sessions never had CCVC checkpoints), but it's why the store persists as the home for
checkpoints, locked titles, and other UI-specific extras.

**Port note — product-identity strings (see `p5-product-identity`):** the backup repo
stamps a git author on every commit (`src/backupRepo.ts`: name `CCVC`, email
`ccvc@appcloud9.com`). That literal must become `CCVI` / `ccvi@appcloud9.com` in the
port. Better: source it from a single product-identity constant so the port flips one
value rather than chasing scattered `"CCVC"` literals — and audit other hardcoded
product strings (status-bar tooltip, package metadata) the same way.

**Risks to weigh:** (1) **format drift** — you now *depend* on reading Claude's
`.jsonl` schema, not just optionally; the picker's existence suggests Anthropic
treats it as a stable-ish interface, but it's not a contract. (2) **No programmatic
list command** — confirmed from `claude --help`: the `/resume` picker is TUI-only,
there is no `claude list-sessions`. So the sidecar must **read the `.jsonl`
directory itself**, not shell out to a CLI listing. (CCVI's sidecar is well-placed
for this — it's the same `subprocess.ts` parser, already reading that dir.)

### Phase 5 — Parity, compliance, distribution

- `p5-parity-audit`: audit against CCVC's feature set and punch-list gaps —
  checkpoints/restore (backup git repo, [src/backupRepo.ts](src/backupRepo.ts)),
  conversation history ([src/conversation.ts](src/conversation.ts)), queue-while-busy,
  permission cards ([src/permissions.ts](src/permissions.ts)), images, breakout
  terminal ([src/terminalCommands.ts](src/terminalCommands.ts)). Much of this rides
  free via the sidecar (it's the same host); the gaps are UI-host-specific (e.g.
  terminal breakout → IntelliJ terminal API instead of VS Code's). **Decide here
  (or in a Phase 4 spike) the fork/session-visibility divergence** — see "Divergence:
  the sidecar owns child stdio" above: match CCVC (forks detached/invisible) or lean
  into the sidecar for a unified session tree.
- `p5-compliance`: carry over the thin-launcher posture verbatim
  ([doc/ccvc_compliance_and_terms.md](doc/ccvc_compliance_and_terms.md),
  [CLAUDE.md](CLAUDE.md) guardrails). The sidecar still just spawns the user's own
  authenticated `claude`; the plugin adds no auth surface, handles no credentials,
  stays human-in-the-loop. The restart control restarts the process only — never
  `claude login`. Confirm explicitly; this is a stop-and-ask boundary.
- `p5-distribution`: `buildPlugin` produces an installable zip; local install via
  "Install Plugin from Disk." Decide JetBrains Marketplace vs. personal-only (the
  same trademark/independence framing as CCVC's README applies). JetBrains review
  has its own bar if published.

Exit: an installable CCVI plugin at functional parity for the core loop, plus the
native plan panel.

## Files (CCVC) used as reference resources

- [src/webview/vscode.ts](src/webview/vscode.ts) — the one file to replace (bridge surface + protocol unions).
- [src/webview.ts](src/webview.ts) — host-side message switch (the contract the sidecar must honor).
- [src/subprocess.ts](src/subprocess.ts) — `claude` spawn + `stream-json` parsing + turn health; reuse wholesale in the sidecar.
- [src/settings.ts](src/settings.ts), [src/modes.ts](src/modes.ts) — settings + mode-state mirror; adapt config source to PersistentStateComponent.
- [src/webview/](src/webview/) — the entire Preact UI, reused via the bundle.
- [vite.config.ts](vite.config.ts) — bundle build base.
- [doc/ccvc_compliance_and_terms.md](doc/ccvc_compliance_and_terms.md) — compliance posture to carry over.

## Implementation details

- **Bridge surface (`jcefBridge.ts`)** must export exactly what `vscode.ts` does so
  the webview is a drop-in: `post(msg: MessageToExtension): void`,
  `on<T>(type, handler): () => void`, and re-export the unions. Receive path: the
  plugin calls `executeJavaScript("window.__ccviReceive(<json>)")`; `jcefBridge`
  defines `window.__ccviReceive` to fan out to `on()` listeners (mirrors the current
  `window.addEventListener('message')`). Send path: `post()` calls
  `window.cefQuery({ request: JSON.stringify(msg) })`, handled by `JBCefJSQuery`.
- **Sidecar framing**: newline-delimited JSON, one message per line, each
  `MessageToExtension`/`MessageFromExtension`. The sidecar's "post to webview"
  becomes `process.stdout.write(JSON.stringify(msg) + "\n")`; its inbound switch
  reads stdin lines. Keep `claude`'s own stream-json on a separate child pipe — do
  not multiplex it with the sidecar control channel.
- **Code reuse mechanism** (decide in p1-bundle-build): git submodule of CCVC,
  vendored snapshot, or a thin shared package. Submodule keeps it honest as CCVC
  evolves but complicates the build; vendoring is simplest to start.

## Edge cases

- **JCEF absent/disabled** on a given IDE build → detect at tool-window init; show a
  graceful message rather than a blank panel. (Phase 0 gates this.)
- **Sidecar crash** → ProcessHandler detects exit; surface "session needs attention"
  and offer restart (process restart only — compliance: never login).
- **Node not installed** → the sidecar needs a Node runtime; detect and guide, or
  bundle a Node runtime with the plugin (decision for p2-process-mgmt).
- **Theme switch at runtime** → re-inject `--vscode-*` vars on `LafManagerListener`.
- **Two tool windows, one sidecar** → decide whether chat + plan panels share one
  sidecar (likely yes) and how they address messages.
- **Windows/WSL** → CCVC has WSL handling in the host; verify it survives the sidecar move.

## What we are NOT doing

- **Not rewriting the host in Kotlin** (decided: Node sidecar). Native rewrite is a
  possible far-future optimization of hot paths, explicitly out of scope here.
- **Not rebuilding the UI in Swing/Compose** (decided: JCEF reuse). 
- **Not adding any authentication, credential handling, or request routing** — the
  compliance posture is inherited unchanged; such work is stop-and-ask.
- **Not headless/background automation** — same human-in-the-loop invariant as CCVC.
- **Not migrating CCVC itself** — CCVI is a parallel product; CCVC stays as-is and
  serves as the reference implementation.

## Open questions

- **Code-reuse mechanism**: submodule vs. vendor vs. shared package for CCVC's
  webview + host source into CCVI? (Affects p1/p2; lean vendor-first.)
- **Node runtime**: assume user-installed Node, or bundle one with the plugin?
  (Affects distribution size + reliability.)
- **Target IDE scope**: IntelliJ IDEA only, or all JetBrains IDEs (PyCharm, WebStorm,
  …)? The platform plugin can target the umbrella, but testing surface grows.
- **Minimum IntelliJ version**: pin to a build new enough for stable JCEF + the
  Gradle plugin; confirm against the user's actual IDEA version.
- **Plan panel rendering tech**: Swing/`JBList` vs. a second JCEF view reusing web
  rendering? (Reuse argues JCEF; native feel argues Swing.)
- **Distribution**: personal-only (like CCVC) or JetBrains Marketplace (adds review +
  trademark considerations)?

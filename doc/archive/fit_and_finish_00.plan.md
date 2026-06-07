---
name: Fit & finish 00
overview: >
  A collected punch-list of prompt-pane and settings polish: prune non-native
  cruft (Add menu), reskin/reorder the input buttons, and make the terminal/WSL
  settings platform-aware. Guiding principle — capability parity with Claude
  Code, not keystroke parity: expose CC's capabilities through GUI-native
  affordances; never reimplement or overload what CC already does.
todos:
  - id: remove-add-menu
    content: "Remove the Add menu (Plugins/Skills/MCP) from the prompt pane — dead placeholders, non-native"
    status: pending
  - id: paperclip-reskin
    content: "Reskin the @ button to a paperclip 'Attach file' (cosmetic only — path already converges via handleDroppedUris)"
    status: pending
  - id: reorder-buttons
    content: "Reorder right-side input buttons: paperclip · image · / · terminal · breakout (· Send)"
    status: pending
  - id: plan-button-injector
    content: "Reimplement Plan button as a prompt-injector: inject '/modes plan ./doc' (don't send), remove the checkbox/planMode flag + respawn path"
    status: pending
  - id: gate-wsl-windows
    content: "Gate the WSL settings section to Windows only (hide on macOS/Linux); label with detected OS"
    status: pending
  - id: terminal-section-mode-aware
    content: "Make the Terminal settings section OS-aware + WSL-mode-aware (app picker vs. single command line)"
    status: pending
  - id: lowercase-button-labels
    content: "Lowercase button labels (plan, send, add, stop; AskUserQuestion → 'cancel' / 'send'). YOLO stays caps; Thoughts/effort title-case stays."
    status: pending
  - id: enrich-command-palette
    content: "Enrich the slash-command palette: surface argumentHint (usage) + aliases (already in handshake, currently dropped); stretch: a 'show help' affordance that runs /<cmd> help"
    status: pending
  - id: image-button-converge
    content: "(optional) Route selectImageFile through the shared handleDroppedUris funnel for consistency"
    status: pending
isProject: false
---

# Fit & finish 00

## Background

A grab-bag of polish items surfaced while discussing Claude Code parity. The
unifying decision behind most of them is a sharpened product principle:

> **Capability parity, not keystroke parity.** The extension gives you
> everything Claude Code can do — but exposed through GUI-native affordances,
> not by reproducing CC's TTY interactions. If CC has the functionality, we
> drive *CC's* version (commands / control protocol / slash-command
> pass-through). We do **not** create new functionality or overload what CC
> does. (The only net-new pieces are the two companion skills, still being
> noodled on.)

This principle is why the Add menu gets cut (it reimplemented install/management
that CC owns natively) and why `@`/attach is fine (file-into-context *is* a CC
capability — we're just offering a GUI affordance for it). Consider promoting
this principle into [vision.md](vision.md) as well.

> **QA note:** Windows + WSL items can be verified by the user's brother — a
> Windows/Linux/WSL daily user and willing test resource. Anything tagged
> *verify-on-Windows* below routes to him.

## Items

### 1. Remove the Add menu (`remove-add-menu`)

The prompt pane's **Add** dropdown (Plugins / Skills / MCP Servers) is dead. Each
item posts `showPluginsModal` / `showSkillsModal` / `showMCPModal`, opening a
modal that renders a single line of placeholder text ("Plugins will be loaded
from the extension"). No list, no install, no management — and the messages
aren't even handled in the extension-host switch. **Cut it entirely.**

Why, not just how: Claude Code already manages plugins (`claude plugin …`),
skills (skills dir + `/skills`), and MCP (`claude mcp …` / `/mcp`) natively. The
old `claude-code-chat` predecessor *did* implement these — but by **sideloading**
(hand-writing `~/.claude/skills/*`, mutating `settings.enabledPlugins`, writing
`~/.claude.json` / `.mcp.json` directly), i.e. poking CC's internal on-disk
formats. That's fragile (formats drift between CLI versions) and violates the
principle. We will **not** port that mechanism. If MCP/skills/plugins management
is wanted later, it rides CC's native commands / control requests / pass-through
— tracked separately in the parity plan, not here.

- Remove the connect/Add menu markup + the three modal components
  ([PluginsMarketplace](../src/webview/components/PluginsMarketplace/PluginsMarketplace.tsx),
  [SkillsMarketplace](../src/webview/components/SkillsMarketplace/SkillsMarketplace.tsx),
  [MCPServersList](../src/webview/components/MCPServersList/MCPServersList.tsx)).
- The **Plan** button stays but is reimplemented (see item 4).

### 2. Reskin `@` → paperclip (`paperclip-reskin`)

The `@` button opens an OS file-open dialog (`selectFile` → `selectAnyFile`).
The `@` glyph implies *typing* (CC's `@` is an inline file-mention autocomplete,
a TTY affordance) — but ours is a *click* button, so the glyph is misleading. A
**paperclip** ("Attach file") reads correctly for a click-to-pick affordance.

- **Cosmetic only.** Verified: `selectAnyFile` already funnels through
  `handleDroppedUris` ([src/webview.ts](../src/webview.ts)) — the *same*
  convergence point drag-drop uses — which auto-routes by extension (image →
  `imageAttached`, code/text → `fileDropped`, else `dropUnsupported`). So the
  button is already behaviorally equivalent to dropping a file. Just change the
  icon + label + tooltip; no plumbing.
- Drag-drop discoverability is **not** being addressed: it requires holding
  Shift, which is a platform-level limitation (VS Code sets the webview's
  `pointer-events: none` during a drag and only re-enables on Shift, in the host
  layer — so the webview can't even detect the drag-over to show a hint;
  confirmed via VS Code PR #209211 / issue #182449). The paperclip + image
  buttons are sufficient; drag-drop stays a hidden power-user bonus.

### 3. Reorder right-side buttons (`reorder-buttons`)

Current order (L→R): `slash · @ · image · terminal · breakout · Send`.
**Target:** `paperclip · image · / · terminal · breakout · Send`.

So: paperclip moves to the front, `/` moves to after image. Send stays last.
Pure JSX reordering in
[PromptPane.tsx](../src/webview/components/PromptPane/PromptPane.tsx)
`.right-controls`.

### 4. Reimplement the Plan button as a prompt-injector (`plan-button-injector`)

Today the Plan button toggles a local `planMode` signal (with a checkbox) that
becomes a spawn-time `--permission-mode plan` arg — forcing a kill/respawn of the
Claude subprocess. Replace that entirely with a **prompt-injector**:

- **Click → inject `/modes plan ./doc` into the input, focused, cursor at end —
  and DON'T send.** The user reviews/edits (e.g. swaps the dir) and hits Send
  themselves.
- **Remove the checkbox and the `planMode` flag + respawn path.** The button no
  longer holds state — there's nothing to check. (The checkbox reflected a flag
  that no longer exists under this model.)
- Seed dir is a **hardcoded `./doc`** — no setting, no popup, no "make this your
  default" memory. It's already editable inline; that's enough. (Considered
  last-used-dir persistence and a confirm-as-default popup; both rejected as
  over-engineering for a dir that rarely changes.)

Why this is the right model (and principle-aligned):
- **It serves the differentiator.** CC's *native* plan mode (`--permission-mode
  plan`) is read-only and produces a conversational plan — it writes **nothing**,
  not even a `.plan.md`. The `modes` skill produces the **Cursor-compatible
  `*.plan.md`** that feeds the plans panel — wedge #2. So we deliberately drive
  the skill, not native plan mode. (Native plan mode officially blocks ALL
  writes, full stop — so a hybrid was never possible; the skill is the only path
  that yields the artifact.)
- **Capability-not-keystroke + teaching.** The button is a GUI affordance that
  *reveals* the underlying `/modes plan` command (and its syntax) rather than
  hiding it — discoverable, editable, transparent. Skills are also where Claude
  Code itself is heading, so this rides the grain.
- **In-band over respawn.** Kills the old kill/recreate-every-turn plumbing.

Dependencies / notes:
- Requires the **`modes` skill** installed (first-run already recommends it). If
  absent, the injected command no-ops in CC — acceptable; first-run covers it.
- **Companion cross-repo change** (in `skills-anthropic`, not this repo): loosen
  the modes-skill **plan mode to allow editing any `.md`, favoring `.plan.md`**
  (mirrors Cursor's plan mode). Currently it hard-restricts to `*.plan.md`, which
  has caused friction (e.g. needing explicit permission to edit `vision.md`).
  "Favor" = `.plan.md` is the recommended output naming; any `.md` is writable.
- The injected default could later read a setting, but **not now** — `./doc`
  hardcoded.

### 5. Gate WSL settings to Windows (`gate-wsl-windows`)

WSL is **fully wired and functional** — but only on Windows (it spawns the real
Claude process via `cp.spawn('wsl', ['-d', distro, 'bash', '-ic', …])`, uses
`wsl pkill` for teardown, and does Windows→WSL path translation, all in
[subprocess.ts](../src/subprocess.ts)). On macOS/Linux the `wsl` binary doesn't
exist, so the settings are inert. **Hide the entire WSL settings section unless
`platform === 'win32'`.** Platform is already known via `sendPlatformInfo`
([src/webview.ts](../src/webview.ts)). Add a "Detected OS: Windows" style header
so it's clear why it appears.

### 6. Terminal settings: OS-aware + WSL-mode-aware (`terminal-section-mode-aware`)

Two distinct axes that currently feel tangled:
- **Terminal app picker** = *which GUI terminal to launch* for breakout / cold
  terminal. Only affects the external-launch path
  ([getTerminalLaunchCommand](../src/webview.ts)); the headless Claude subprocess
  never uses it.
- **WSL** = *where the Claude process runs* (a runtime/environment switch), which
  also happens to reshape the breakout command.

They are different layers (presentation vs. execution environment), so they stay
**separate sections** — but both become detection-driven:

- **WSL OFF (or non-Windows):** show the OS-detected app picker — label it with
  the detected OS ("Detected: macOS — Terminal.app, iTerm2, Ghostty, kitty…";
  Windows would list Windows Terminal / PowerShell / cmd) — plus the existing
  custom-command line as a fallback. (We already detect via `which`/app checks;
  make it *explicit and labeled*.)
- **WSL ON:** gray out / hide the app picker (its AppleScript/native-app launch
  recipes don't apply to a `wsl.exe … bash -ic` launch). Replace with a **single
  "terminal command" line** — reuse the existing `terminal.customTemplate`
  (`{{command}}`) plumbing — seeded with a sensible WSL placeholder, e.g.
  `wt.exe -d Ubuntu wsl.exe -d Ubuntu bash -ic "{{command}}"` *(illustrative —
  verify on Windows)*. Rationale: under WSL the launch is too environment-
  specific to enumerate, so hand the user the template + a starter.

*verify-on-Windows:* the exact working placeholder, and that the WSL +
terminal-app launch composes correctly on a real Windows+WSL box (→ brother).

### 7. Lowercase button labels (`lowercase-button-labels`)

Stylistic: stop title-casing action-button labels — they read softer lowercase.

| Label | Where | → |
|---|---|---|
| `Plan` | [PromptPane.tsx](../src/webview/components/PromptPane/PromptPane.tsx):622 | `plan` |
| `Send` | PromptPane.tsx:720 | `send` |
| `Add` | PromptPane.tsx:536 (+ menu header :548) | `add` — moot if the Add menu is removed (item 1); lowercase only if it survives |
| `Stop` | PromptPane.tsx (stop-inline-btn) | `stop` |
| `Submit` | [AskUserQuestion.tsx](../src/webview/components/AskUserQuestion/AskUserQuestion.tsx):289 | `send` |
| `Cancel` | AskUserQuestion.tsx:286 | `cancel` |

- **AskUserQuestion:** `Submit` → **`send`** (not "submit" — you're not submitting
  for approval, you're sending your answers; also not "answer"), and `Cancel` →
  `cancel`. Both lowercase.
- **Stays as-is:** **`YOLO`** (all caps, intentional), and the **Thoughts toggle**
  / **effort** labels (title/sentence case is fine there).
- Note overlap with item 1 (Add menu likely removed) and item 4 (Plan button
  reimplemented as injector — keep its label lowercase `plan` when rebuilt).

### 8. Enrich the slash-command palette (`enrich-command-palette`)

The palette ([CommandAutocomplete](../src/webview/components/CommandAutocomplete/CommandAutocomplete.tsx))
shows only `/name` + `description` + a skill badge — most descriptions aren't
very instructive, and there's no param/usage hint. But the `initialize`
handshake already hands us **more than we render**: each command arrives as
`{ name, description, argumentHint, aliases }`, and `mapCommandForWebview`
([subprocess.ts](../src/subprocess.ts) ~line 940) **drops `argumentHint` and
`aliases`** — `WebviewCommand` only keeps `name`/`description`/`type`.

This is the same "we already receive it, we just don't surface it" pattern as the
health-monitor heartbeats. **Principle-clean:** we're surfacing CC's own
structured fields more fully, NOT authoring or overloading its copy.

- **Thread `argumentHint` + `aliases` through** `mapCommandForWebview` →
  `WebviewCommand` / `CommandInfo` ([state/commands.ts](../src/webview/state/commands.ts)).
- **Render a usage signature** in each palette row: `/model [model]`,
  `/compact <optional custom summarization instructions>`, etc. (argumentHint is
  CC's own param hint). Optionally show aliases (`/clear` aka `reset`, `new`).
- **Stretch — command-authored help:** a `?` / hover / expand affordance that
  invokes the command's **own `/<cmd> help`** to show rich, real usage examples.
  This is the *right* source for "instructive copy with param examples" — the
  command authors it, not us (authoring our own examples would overload CC's data
  and go stale). The user discovered `/<cmd> help` returns a manual; this surfaces
  it in-UI.

> Note: `argumentHint` is a terse signature (`[interval] <prompt>`), not worked
> examples like `5m /babysit-prs`. Terse hint = easy win (render the field);
> worked examples = defer to the command's own `help` (the stretch), never
> hand-author them.

### 9. (Optional) Converge the image button (`image-button-converge`)

Minor consistency cleanup. Paste, drop, and the paperclip all funnel through the
shared paths (`handleDroppedUris` / `createImageFile`), but `selectImageFile`
([src/webview.ts](../src/webview.ts)) is a standalone re-implementation that posts
`imageAttached` directly. Route it through the shared funnel too so all four
entry points (paste / drop / paperclip / image button) converge. Behavior-neutral
refactor; drop if not worth the churn.

## Edge cases

- **Add-menu removal** — ensure no dangling imports/signals
  (`pluginsModalVisible` etc.) or layout gaps after the connect-menu is pulled.
- **Paperclip** — keep multi-select and the image-vs-code auto-routing intact;
  only the trigger's presentation changes.
- **WSL gating** — make sure hiding the section doesn't strip a Windows user's
  saved `wsl.*` values (gate the *rendering*, not the stored config).
- **Terminal mode-aware** — toggling WSL on/off should live-swap the section
  (picker ↔ command line) without losing the other mode's saved value.

## What we are NOT doing

- **Not** implementing Plugins/Skills/MCP management UI (cut, not rebuilt; native
  CC paths only — see parity plan).
- **Not** adding an `/attach` tool — typing a path in a prompt already gets the
  file into context via CC's Read tool natively; a new command would violate the
  no-new-functionality principle.
- **Not** fixing drag-drop discoverability — platform limitation; accepted.
- **Not** renaming the muddy layout classes (`input-container` /
  central-button-bar naming) — acknowledged, deferred.

## Open questions

- **Does CC's `@` inject file *contents* into context, or just insert a path the
  model then Reads?** Decides whether "type the path" is truly equivalent to `@`
  (informs how complete the paperclip needs to feel). Verify with a read-only
  probe before finalizing.
- More items likely to accumulate before this plan is executed.

---
name: Eager first-spawn on webview-ready (resume last conversation + per-conversation prefs)
overview: "Spawn the Claude Code subprocess eagerly when the webview mounts (webviewReady) instead of lazily on the first turn, so the model picker, effort/thoughts pickers, and context chip are populated before the user types — that data comes from the initialize HANDSHAKE (a control_request), which only runs after a spawn. The first-spawn RESUMES the last conversation (whose history is already loaded into the UI today) by seeding currentSessionId before spawn (spawnProcess already passes --resume when a session id is set). It spawns with that conversation's OWN model/effort/thoughts, newly persisted IN the conversation record (Design B — portable across the future IntelliJ port, unlike workspaceState), with a fallback chain (conversation prefs → workspaceState → config default) so pre-existing conversations don't cold-default. Always spawn on panel open (a deliberate user action; cost accepted)."
todos:
  - id: persist-prefs-in-conversation
    content: "Add model/effort/thoughts to ConversationData (src/conversation.ts interface ~line 9) and write them when a conversation is saved (sendAndSaveMessage's conversationData build ~line 163, and parkToHistory). Pull current values from settings.getSelectedModel/getEffort/getThoughtsOn at save time. Portable (lives in the conversation JSON we own), not VS Code-specific. Old records simply lack the fields → handled by the fallback in first-spawn."
    status: pending
    phase: "persist"
  - id: prefs-resolver
    content: "Add a resolver (settings.ts or conversation.ts) that returns the model/effort/thoughts to spawn with, in priority order: (1) the resumed conversation's saved prefs, (2) workspaceState (the existing claude.selectedModel/effort/thoughtsOn), (3) config default. This is 'Design B with A fallback' — workspaceState is the TRANSITIONAL fallback the IntelliJ port can later drop; the conversation record is the canonical portable source."
    status: pending
    phase: "persist"
  - id: eager-spawn-trigger
    content: "In the webviewReady handler (src/webview.ts case \"webviewReady\" ~line 499), after the existing last-conversation history load, trigger an eager first-spawn: seed conversation.currentSessionId to the last conversation's sessionId (so spawnProcess passes --resume), apply the resolved prefs (prefs-resolver) into settings BEFORE spawn so spawnedThinkingSig matches and the first real turn won't respawn, then spawn. Reuse subprocess.spawnProcess; do NOT send any turn/prompt. Always spawn (panel-open is a deliberate user action)."
    status: pending
    phase: "spawn"
  - id: expose-first-spawn
    content: "Add a subprocess.ts entry point for the eager spawn (e.g. firstSpawn()) that: guards against double-spawn (no-op if a live process already exists), spawns via the existing spawnProcess path (which already fires the initialize handshake fire-and-forget and pushes modelList + context chip), and is safe to call once on webviewReady. Plan mode is NOT a spawn arg anymore, so pass the current plan/agent state as spawnProcess expects without it forcing anything."
    status: pending
    phase: "spawn"
  - id: settings-ordering-guard
    content: "Ensure the resolved prefs are applied to settings (effort/thoughts/model) BEFORE firstSpawn reads getThinkingSig()/getSelectedModel() — otherwise the eager spawn bakes in defaults and the first real turn sees thinkingChanged=true and triggers the one avoidable respawn. If settings load is async relative to webviewReady, sequence the spawn after it. DONE-WHEN: first real turn after an idle eager-spawn reuses the warm process (log shows 'reusing warm process', not 'respawn required')."
    status: pending
    phase: "spawn"
  - id: no-resume-when-no-history
    content: "Handle the fresh-install / no-last-conversation case: if getLatestConversation() is undefined, eager-spawn a BRAND-NEW session (no --resume, currentSessionId stays undefined — the CLI mints the id) using workspaceState→config-default prefs. Still spawns (so pickers populate); just doesn't resume a nonexistent thread."
    status: pending
    phase: "spawn"
  - id: verify-pickers-populated
    content: "Behavioral check: open the panel fresh, do NOT type. Within the handshake window, the model picker shows the resolved model selected, effort + thoughts reflect the resumed conversation's prefs, and the context chip is populated — all before any turn. Then type a first turn and confirm it CONTINUES the resumed conversation (no new session minted) and does not respawn."
    status: pending
    phase: "verify"
  - id: bbpi
    content: "Bump appcloud9.X in package.json to the next version, then compile, package, install the VSIX (BBPI)."
    status: pending
    phase: "release"
isProject: false
---

# Eager first-spawn on webview-ready

## Problem / Context

Today the Claude Code subprocess spawns **lazily on the first turn**
([subprocess.ts](src/subprocess.ts) comment ~line 36: "spawned lazily on the first turn").
The data that makes the UI feel alive — the **model picker list**, **effort/thoughts**
state, and the **context-usage chip** — is populated by the **`initialize` handshake**
([subprocess.ts](src/subprocess.ts) ~line 908/916), which is a `control_request` that runs
*after a spawn*, not by a chat turn. So before the first turn there's no process → no
handshake → an empty/un-selected picker and a blank chip. The panel looks half-asleep until
you send something.

We already **load the last conversation's history into the UI at startup**
([webview.ts](src/webview.ts) ~line 116/254, `getLatestConversation()` → `loadConversationHistory`),
but that's **display-only** — nothing spawns or resumes a live process. So the visible
history isn't actually "live" until the first turn.

**Goal:** spawn eagerly on `webviewReady` so the pickers/chip populate immediately, and make
that first-spawn **resume the last conversation** so the loaded history is genuinely live —
spawning with **that conversation's own** model/effort/thoughts.

## Approach

Three moving parts, all building on machinery that already exists:

1. **Eager trigger.** `spawnProcess` already (a) fires the initialize handshake
   fire-and-forget after spawn and (b) passes `--resume` when `getCurrentSessionId()` is set,
   else mints a new session ([subprocess.ts](src/subprocess.ts) ~line 536/595-598). So
   first-spawn = "set `currentSessionId` to the last conversation's id, apply its prefs, call
   spawnProcess" — from the `webviewReady` handler. No turn, no prompt.

2. **Per-conversation prefs (Design B, chosen for PORTABILITY).** Model/effort/thoughts are
   currently only in `workspaceState` (VS Code-specific, per-project, clobberable across two
   windows on one project). Instead, persist them **in the conversation record**
   ([conversation.ts](src/conversation.ts) `ConversationData` ~line 9) — a plain JSON file we
   own, identical across Cursor and the future IntelliJ port. First-spawn reads the resumed
   conversation's own prefs. **Fallback chain** (conversation prefs → workspaceState → config
   default) keeps pre-existing conversations from cold-defaulting; workspaceState is explicitly
   the *transitional* fallback the IntelliJ port can drop.

3. **Always spawn on panel open.** Opening the panel is a deliberate user action (the panel
   does NOT auto-open on Cursor reload — the user must choose to open it), so paying the
   cold-start every open is accepted — "we exist to have a Claude instance behind the
   extension; sooner is better."

Key existing anchors: `webviewReady` handler ([webview.ts](src/webview.ts) ~line 499);
`spawnProcess(planMode)` and its `--resume`/handshake logic
([subprocess.ts](src/subprocess.ts) ~line 538, 595); `ConversationData` +
`getLatestConversation()` ([conversation.ts](src/conversation.ts) ~line 9, 86);
prefs load/persist in [settings.ts](src/settings.ts) (`getSelectedModel`/`getEffort`/
`getThoughtsOn`/`getThinkingSig`, ~line 26-106).

## Conventions & assumptions

- **Per-conversation prefs are the canonical source; workspaceState is a transitional
  fallback.** Frame the code so the portable path (conversation record) is primary. This is
  the deliberate choice for IntelliJ-portability — `workspaceState` has no clean cross-IDE
  equivalent; the conversation JSON does.
- **plan mode does NOT force a respawn** (it's a prompt-injected skill now, not a
  `--permission-mode` spawn arg — [subprocess.ts](src/subprocess.ts) ~line 482). So the eager
  spawn's plan/agent state doesn't cause a first-turn respawn. The ONLY respawn trigger that
  matters here is `thinkingChanged` (effort/thoughts differ from spawn) — which is why
  `settings-ordering-guard` exists.
- **The handshake is free** (a `control_request` — no tokens, no model inference, no
  conversation entry) and already fire-and-forget. Eager-spawn only changes *when* it runs.
- **Resume is harmless if never continued** — a resumed-but-idle session costs nothing; the
  user's first turn continues it, or they start a new session via the existing newSession path.
- **Double-spawn guard required** — `firstSpawn()` must no-op if a live process already exists
  (webviewReady can fire on re-mount; never stack two children on one session — the same
  invariant the respawn path protects at ~line 492).
- Assumes `getLatestConversation()` is populated at `webviewReady` time (it is — the index
  loads at activation, and the handler already reads it for history display).

## The steps

### persist

1. **`persist-prefs-in-conversation`** — [conversation.ts](src/conversation.ts): add
   `model?: string; effort?: string; thoughtsOn?: boolean` to the `ConversationData` interface
   (~line 9), and populate them in the `conversationData` object built in `sendAndSaveMessage`
   (~line 163) and in `parkToHistory` — reading `settings.getSelectedModel()/getEffort()/
   getThoughtsOn()` at save time. WHY: the portable, per-thread source of truth for first-spawn
   prefs. DONE-WHEN: a freshly saved conversation's JSON contains its model/effort/thoughts;
   old conversations simply lack the fields (no migration needed).

2. **`prefs-resolver`** — add `resolveSpawnPrefs(conversationData?)` returning
   `{model, effort, thoughtsOn}` by priority: (1) the passed conversation's saved fields if
   present, (2) workspaceState (`claude.selectedModel`/`effort`/`thoughtsOn`), (3) config
   default. WHY: B-with-A-fallback so pre-existing/no conversations don't cold-default. DONE-WHEN:
   resolver returns conversation prefs when present, workspace prefs when not, config default
   when neither.

### spawn

3. **`expose-first-spawn`** — [subprocess.ts](src/subprocess.ts): add
   `export async function firstSpawn()` that no-ops if `currentClaudeProcess` is live
   (double-spawn guard), else calls the existing `spawnProcess(...)` path (which fires the
   handshake + pushes modelList/chip). WHY: a single safe eager entry point distinct from the
   per-turn spawn-vs-reuse logic in `sendMessage`/`runTurn`. DONE-WHEN: calling it once spawns +
   handshakes; calling it again while live is a no-op.

4. **`eager-spawn-trigger`** — [webview.ts](src/webview.ts) `case "webviewReady"` (~line 499),
   after the existing history load: (a) if a last conversation exists, set
   `conversation.setCurrentSessionId(last.sessionId)` so `spawnProcess` resumes it; (b) resolve
   prefs via `resolveSpawnPrefs(lastConversationData)` and apply them into settings
   (`setEffort`/`setThoughtsOn`/`setSelectedModel`) BEFORE spawning; (c) call
   `subprocess.firstSpawn()`. No turn is sent. WHY: this is the eager-spawn that makes pickers/
   chip live and binds the resumed thread. DONE-WHEN: opening the panel spawns a process resuming
   the last session, with no prompt sent.

5. **`settings-ordering-guard`** — guarantee prefs are applied to settings BEFORE `firstSpawn`
   reads `getThinkingSig()`/`getSelectedModel()`. If settings load is async vs. webviewReady,
   await/sequence it. WHY: otherwise the eager spawn bakes defaults and the first real turn sees
   `thinkingChanged=true` → an avoidable respawn. DONE-WHEN: the first real turn after an idle
   eager-spawn logs "reusing warm process", never "respawn required".

6. **`no-resume-when-no-history`** — if `getLatestConversation()` is undefined (fresh install /
   cleared history), eager-spawn a brand-new session: leave `currentSessionId` undefined (CLI
   mints it, no `--resume`), prefs from workspaceState→config-default. WHY: still populate the
   pickers on a fresh install without resuming a nonexistent thread. DONE-WHEN: fresh install
   opens the panel, pickers populate, no `--resume` passed, first turn starts a clean session.

### verify

7. **`verify-pickers-populated`** — behavioral: open panel fresh, don't type → within the
   handshake window, model picker shows the resolved model, effort/thoughts reflect the resumed
   conversation, context chip populated. Then type → first turn CONTINUES the resumed conversation
   (no new session id minted) and does NOT respawn. WHY: proves the whole point — live data before
   first turn + faithful resume. DONE-WHEN: all of the above observed in the running extension.

### release

8. **`bbpi`** — bump `appcloud9.X` to the next version, `npm run compile`, package, install.
   DONE-WHEN: new VSIX installs; version incremented.

## Out of scope

- **No "warm-up turn" / fake prompt** — the data comes from the handshake (free), not a turn.
  Never send a prompt to populate pickers (tokens, history pollution, model call — the wrong fix).
- **Don't change the lazy-spawn path's per-turn spawn-vs-reuse logic** — eager-spawn is additive;
  the existing `needSpawn` decision in `runTurn` stays as-is.
- **Don't migrate old conversation records** — missing prefs fields fall through the resolver;
  no rewrite of historical JSON.
- **Don't make plan mode a spawn arg again** — it's a prompt-injected skill; leave it.
- **Don't auto-open the panel on Cursor launch** — opening is the user's deliberate action; we
  only spawn once they've opened it.
- **Don't drop workspaceState yet** — it remains the transitional fallback; removing it is an
  IntelliJ-port concern, not this plan.

## Verification

- Open the panel without typing: model picker populated + correct model selected, effort/thoughts
  reflect the last conversation, context chip filled — all pre-first-turn.
- First turn continues the resumed conversation (same session id, history contiguous) and logs
  "reusing warm process" (no respawn).
- Fresh install (no history): panel still spawns + populates pickers; first turn starts a clean
  session (no `--resume`).
- A newly saved conversation's JSON carries model/effort/thoughts; an old one without them still
  resumes fine via the fallback.
- `npm run compile` clean; new VSIX installs.
- **On `--resume` confidence:** eager-spawn uses plain `--resume <id>` (continue-in-place) — NOT
  the `--resume … --fork-session` of the breakout path. They're different semantics, but plain
  `--resume` is ALREADY the mechanism every normal warm-respawn uses (e.g. on an effort change),
  exercised constantly — eager-spawn only changes the TIMING (webviewReady vs. post-turn), which
  doesn't affect whether the CLI accepts the id. So success is expected, not novel.
- **Escape hatch:** if eager-spawn's prefs can't be applied before spawn without a fragile async
  race (settings ordering), STOP and surface — a one-respawn-on-first-turn fallback is acceptable
  but should be a conscious choice, not a silent race. If eager `--resume` ever DOES fail, DEGRADE
  to a fresh spawn (do not block) — the pickers/chip populate from the handshake on any spawn,
  resumed or fresh, so the must-have (live menus) survives even if the nice-to-have (auto-resume)
  hiccups.

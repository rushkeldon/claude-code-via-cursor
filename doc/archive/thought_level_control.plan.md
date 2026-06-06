---
name: Effort + Thoughts pickers and always-on thinking affordance
overview: >
  Fix the dark thinking pane on Opus 4.8 (display defaults to "omitted") and add two
  model-aware controls to the prompt pane's picker row: an Effort picker (thinking
  depth, options driven by each model's supportedEffortLevels) and a Thoughts On/Off
  toggle (whether summarized thought text is shown). The thinking pane becomes an
  always-on activity affordance — bubble + "thought for Ns" on every turn, regardless
  of the toggle. The legacy THINK/ULTRATHINK prompt-prefix hack and thinking.intensity
  setting are removed. Pickers gate on per-model capability flags; no legacy
  budget_tokens fallback. All prefs live in extension-owned storage and are injected at
  launch (--model + --settings, both verified) — the extension never writes the
  developer's settings.local.json, which also dissolves the model-revert bug.
todos:
  - id: diagnostic-ab
    content: "GATES EVERYTHING — DO FIRST. ❌ RESULT: NEGATIVE — THE LEVER DOES NOT WORK ON THIS BEDROCK ACCOUNT. Tested on the real authenticated binary (probe_display.mjs / probe_vectors.mjs / probe_ab.mjs, CLI 2.1.165, CLAUDE_CODE_USE_BEDROCK=1, opus-4-8[1m]). Findings: (a) --settings {thinkingDisplay:summarized,showThinkingSummaries:true} lands the keys in `effective` but they NEVER reach `applied`, and produce ZERO streamed thinking_delta on a live 4.8 turn (only signature_delta — the dark-pane fingerprint). (b) apply_flag_settings in-band: same — keys in effective, applied unchanged. (c) effort:low never moved applied.effort off 'high' either. (d) DECISIVE A/B under IDENTICAL summarized settings: Opus 4.6 streamed 112 thinking_delta events / 990 chars; Opus 4.8 streamed 0. 4.6 shows thinking on Bedrock even with NO settings; 4.8 cannot be made to via any documented lever. CONCLUSION: on Bedrock, thinkingDisplay/effort are not honored for 4.8 — but 4.6/earlier work. DECISION (resolved): BUILD TO CONTRACT, not blocked. This is a known UPSTREAM issue (claude-code #49268, #56356 — flag set, no thoughts), not our code: the schema is correct (4.8 omitted = empty thinking field + signature_delta, nothing hidden), and the binary has NO client-side Bedrock gate for summarized thinking, so the block is server-side/version on Bedrock. Cursor shows 4.8 thoughts because it routes through first-party Anthropic, not the user's Bedrock CLI — so the fix vector is VALID, just provider-dependent. We implement exactly to the advertised contract; thoughts light up wherever the provider honors them. See the 'Build-to-contract stance' section."
    status: completed
  - id: confirm-capability-fields
    content: "GATE #2 — before building any gating. Log one real resp.models[0] entry from the AUTHENTICATED session and confirm the exact field names supportsEffort / supportedEffortLevels / supportsAdaptiveThinking. These were observed in real (unauthenticated, 4-model) binary JSON, so they exist — the residual risk is whether the legacy models (Opus 4.1/4.6/4.7) in the authenticated 11-model catalog also carry them. If a gate field is absent, that picker silently never renders (worst failure mode). One log line settles it. ✅ RESOLVED (probe_capabilities.mjs against authenticated 11-model catalog): field names confirmed EXACT — supportsEffort, supportedEffortLevels, supportsAdaptiveThinking. Entry key is 'value' (not 'id'). Opus 4.8/4.8[1m]/4.7/4.7[1m] = low|medium|high|xhigh|max; Sonnet 4.6 + Opus 4.6 = low|medium|high|max (no xhigh). CORRECTIONS TO PLAN: (1) supportsFastMode/supportsAutoMode do NOT exist on any entry — drop them from the design note. (2) Alias/legacy entries 'default','haiku','us.anthropic.claude-opus-4-1-20250805-v1:0' carry NONE of the fields — gating MUST treat absent field as falsy and hide controls (graceful absence — exactly the planned behavior; Opus 4.1 is pre-adaptive)."
    status: completed
  - id: capture-capabilities
    content: "Widen the typed boundary so the capability fields reach the webview. NOTE: nothing strips them at runtime — cachedModels = resp.models is an any[] passthrough (no .map()), so the data already flows. The only change is widening the modelList message type in vscode.ts and the webview ModelOption interface (currently value/displayName/description) to include supportedEffortLevels?/supportsAdaptiveThinking?/supportsEffort? so the webview reads them without casts."
    status: completed
  - id: launch-injection
    content: "Inject all extension prefs at spawn from extension-owned storage — never write the dev's settings.local.json. Build spawnProcess args: --model <stored model> (verified overrides settings.local.json), and --settings '<json>' carrying thinkingDisplay/showThinkingSummaries (Thoughts) + effort, gated on the selected model's capability flags (only keys it supports). Verified: --settings lands these keys in the effective layer and overrides local; --model changes applied.model. NOTE (build-to-contract): on Bedrock-4.8 the injected thinkingDisplay/effort don't reach `applied` (upstream limitation — see diagnostic-ab), but we inject them anyway per the advertised contract; they take effect wherever the provider honors them (e.g. first-party, or 4.6). The --model half is fully valid and fixes the model-revert bug independently. Not blocked — build it."
    status: completed
  - id: prefs-storage
    content: "Store model/effort/thoughts prefs in extension-owned storage (extend the existing workspaceState 'claude.selectedModel' path; add effort + thoughtsOn). This becomes the single source of truth injected on every spawn/respawn, which dissolves the model-revert bug (in-band set_model writes workspaceState; respawn injects --model from it). Defaults: thoughtsOn=true, effort=unset (inherit model default)."
    status: completed
  - id: message-protocol
    content: "Add setThoughtsDisplay (on|off) and setEffort (level) to MessageToExtension, and a thoughtControlConfig (capability flags + current values) to MessageFromExtension; route both in webview.ts."
    status: completed
  - id: effort-picker
    content: "Add the Effort picker to PromptPane right-controls. Options = the selected model's supportedEffortLevels; shown only if supportsEffort. Clamp the current selection to the nearest valid level on model change."
    status: completed
  - id: thoughts-toggle
    content: "Add the Thoughts On/Off toggle to PromptPane right-controls. Shown only if supportsAdaptiveThinking. On=display summarized (default), Off=display omitted. Thinking stays on in both. ALSO add the honesty affordance: when Thoughts is On but a turn ends with zero thinking_delta text, show a subtle '(no thoughts returned for this model/provider)' note under the bubble so a textless toggle reads as informative, not broken (this is the expected state on Bedrock-4.8)."
    status: completed
  - id: always-on-pane
    content: "Make ThinkingPane always show the bubble + running 'thought for Ns' timer on every turn, driven by thinkingBlockStart/stop, even with zero thought text. With Thoughts On, also render the summarized text in the panel below."
    status: completed
  - id: retire-prompt-prefix
    content: "Remove the Ultrathink button (PromptPane), the thinking.intensity config (package.json), the prompt-prefix hack in runTurn, and the now-unused thinkingMode per-turn plumbing (sendMessage/queue)."
    status: completed
  - id: apply-timing
    content: "Picker changes queue for the next turn. Model can switch in-band (set_model, already shipped) for the warm process; effort/thoughts apply via a --resume respawn that re-injects --model + --settings from storage. Make all three pickers openable while a turn is in flight (queue + 'applies next turn'); the disabled-while-busy model dead-click is already fixed (appcloud9.82)."
    status: completed
  - id: version-bump
    content: "Bump appcloud9.X to the next version in package.json before packaging. DONE: bumped to appcloud9.84. Host `tsc -p ./` passes; webview type-checks clean (only 6 pre-existing unrelated errors). NOTE: the final `npm run compile` (vite build) + `vsce package` + `cursor --install-extension` must run on the Mac — the sandbox lacks the linux-arm64 rolldown native binding, so vite can't bundle here."
    status: completed
---

# Effort + Thoughts pickers and always-on thinking affordance

## Background

The thinking pane went dark the instant the session pinned to
`us.anthropic.claude-opus-4-8`. Root cause is **verified against the real CLI binary**
(see [`thoughts_on_thoughts.md`](thoughts_on_thoughts.md) §5/§10 and
[`control_protocol_surface.md`](control_protocol_surface.md)): Opus 4.8 defaults
`thinking.display` to `"omitted"` (Opus 4.6 defaulted to `"summarized"`), so the model
still thinks and signs its thinking blocks but never streams summarized thought *text*.
The log fingerprint — `signature_delta` with no `thinking_delta` — is exactly this.

Beyond the fix, the user wants real controls in the prompt pane's picker row (the row
above the input that already holds the model picker). Thinking is billed as **output
tokens** ($25/1M on Opus 4.8 — same meter as the visible response), so dialing depth is
a genuine cost/latency lever. The controls must be **model-aware**: capabilities differ
per model and arrive per-model in the `initialize` catalog.

## Design

### Two orthogonal controls (not one bundled menu)

There are two independent axes; do not conflate them
(see [`thoughts_on_thoughts.md`](thoughts_on_thoughts.md) §11):

- **Effort** — thinking *depth* / how hard it thinks (this is what costs tokens).
  Per-model values, advertised as `supportedEffortLevels` (verified: Opus 4.8 =
  `low|medium|high|xhigh|max`; Sonnet 4.6 = `low|medium|high|max`, **no `xhigh`**).
- **Thoughts** — *visibility* of the summarized thought text. Values `omitted` /
  `summarized`, exposed to the user as a simple **On / Off** toggle.

`adaptive` is **not** a picker value — it is the `thinking.type` mode that both
`omitted` and `summarized` live under, and it stays on for all adaptive models. There
is no display level above `summarized` (raw thinking is not a selectable mode).

### The Thoughts toggle (product decision)

- **On** *(default)* → `thinkingDisplay: "summarized"` — summarized thoughts render in
  the panel below the bubble. This is the dark-pane fix.
- **Off** → `thinkingDisplay: "omitted"` — thought text hidden.
- **In both positions the model still thinks** (it stays adaptive). Off only hides the
  *text*; it does not reduce thinking, cost, or latency. To think less/cheaper, the user
  lowers **Effort**, not the Thoughts toggle.
- **The thinking bubble + "thought for Ns" timer is ALWAYS shown**, On or Off — it is
  the post-Send activity affordance ("something is happening"). On adds the thought text
  beneath it; Off shows bubble + timer only. The thinking block opens and closes at every
  level, which is what gives us the elapsed time even with zero text.

### The Effort picker

A small `Effort ▾` dropdown whose options are the **selected model's**
`supportedEffortLevels`, read from the cached `initialize` catalog (no need to run a
model to know its levels — the whole catalog arrives in one handshake). Show the model's
resolved current effort; write only when the user changes it. On a model switch, clamp
the current selection to the nearest valid level (e.g. Opus `xhigh` → Sonnet has no
`xhigh`, fall back to `high`).

### Model-awareness via capability flags (resolved decision)

Each `initialize` model entry (key is `value`, **not** `id`) carries `supportsEffort`,
`supportedEffortLevels`, `supportsAdaptiveThinking` — **confirmed exact** against the
authenticated 11-model catalog (gate #2). Note: `supportsFastMode`/`supportsAutoMode` do
**not** exist — don't reference them. Gate purely on the three real flags:

- Show the **Effort** picker iff `supportsEffort`.
- Show the **Thoughts** toggle iff `supportsAdaptiveThinking`.
- **Treat an absent field as falsy → hide the control.** Alias/legacy entries (`default`,
  `haiku`, `us.anthropic.claude-opus-4-1-…`) carry **none** of these fields, so they show
  no thinking controls — graceful absence, exactly the intended behavior (Opus 4.1 is
  pre-adaptive). **No `budget_tokens`/legacy fallback is built.** Deliberate scope decision.

## Build-to-contract stance (the gate-#1 decision)

**Gate #1 came back negative on this Bedrock account: Opus 4.8 streams zero thinking
under every display/effort lever (`--settings`, `apply_flag_settings`), while Opus 4.6
streams fine on the same account.** The decision is **build exactly to the advertised
contract and treat the 4.8 gap as a known upstream limitation**, not a blocker. Rationale:

- **It's not our code.** The thinking-block schema is unchanged (4.8 `omitted` = empty
  `thinking` field + `signature_delta`; nothing hidden, our parser is correct), the binary
  has **no client-side gate** withholding summarized thinking on Bedrock, and there are open
  upstream issues for exactly this — [claude-code #49268](https://github.com/anthropics/claude-code/issues/49268)
  and [#56356](https://github.com/anthropics/claude-code/issues/56356) (flag set, no thoughts).
  The block is server-side/version on Bedrock; the docs say `display` is *meant* to thread
  through the Bedrock parser, so it reads as a bug, not a permanent wall.
- **The feature works — it's provider-dependent.** Cursor shows 4.8 thoughts because it
  routes through **first-party Anthropic**, not the user's Bedrock CLI. So 4.8 + summarized
  is real; the extension is just bottlenecked by the Bedrock route (`account.apiProvider`
  = `bedrock`).
- **Gate on the advertised capability flags ONLY — do NOT detect the provider or maintain a
  Bedrock blocklist.** Building to contract is simpler, forward-compatible (the UI lights up
  automatically the day Bedrock/CLI honors it, with zero changes), and robust to the fact
  that the broken condition may be a 4.7/4.8 CLI issue, not strictly Bedrock.
- **The always-on bubble + timer carries the UX.** On Bedrock-4.8 the Thoughts toggle
  degrades gracefully to bubble + timer + the "(no thoughts returned for this model/
  provider)" note — informative, not broken. That affordance was the user's actual core ask.
- **Optional future angle (not in scope now):** a provider/auth toggle (first-party vs
  Bedrock) would let the user *get* 4.8 thoughts in the extension like Cursor — the
  extension already supports custom spawn env (`environment.variables`), so it's feasible.
  Recorded as an option, not a commitment.

## The model list & capability source (confirmed)

The picker list is **not** hardcoded and does **not** come from a dedicated query — it
comes from the `initialize` control response. Verified call chain:

`subprocess.ts` `performInitialize` → `sendControlRequest('initialize', …)` →
`cachedModels = resp.models` (the only assignment) → `postModelList()` (the only emitter
of the `modelList` message) → `state/settings.ts` `on('modelList')` → `modelList` signal
→ `ModelSelector`. The per-model capability fields ride in this same `resp.models`, so
the new pickers read the identical catalog the model picker already uses (the count is
account-gated — an authenticated account returns the full list).

## Where preferences live: extension-owned storage + launch injection (verified)

**Decision: the extension never writes the developer's `.claude/settings.local.json`.**
All extension prefs (model, effort, thoughts) live in extension-owned storage and are
**injected at spawn via launch flags**. This keeps `settings.local.json` purely for
"Claude Code in the wild," makes the extension's storage the single source of truth, and
**dissolves the model-revert bug** (no file to drift from; the same prefs are injected on
every spawn and respawn).

Verified against the binary (project pinned `settings.local.json` to
`model:sonnet, effort:low`, then varied launch flags and read `get_settings`):

| Lever | Result |
|---|---|
| `--model <id>` | **overrides** the file — `--model opus` ⇒ `applied.model = opus` (file's `sonnet` ignored). Fully proven, no auth needed. |
| `--settings '{…}'` | high-precedence merged layer — `--settings '{model:haiku}'` ⇒ `applied.model = haiku`; `effort`/`thinkingDisplay` land in `effective` and override the file's values, leaving other local keys intact. |
| `--setting-sources user,project,local` | chooses which sources load at all; excluding `local` makes `settings.local.json` vanish entirely (optional hard isolation — not needed since flags already win). |
| env `CLAUDE_CODE_EFFORT_LEVEL`, `/effort` cmd | did **not** populate settings in the sandbox — **not** the vector. |

**So the injection plan:** `--model <stored model>` + `--settings '<json>'` carrying
`{ thinkingDisplay, showThinkingSummaries, effort }` (only the keys the selected model
supports). Write nothing to the dev's files.

**Effort/thoughts take-effect (now resolved by `diagnostic-ab`):** `--settings` *lands*
the keys in `effective`, but on **Bedrock-4.8 they never reach `applied`** and produce
zero streamed thinking (upstream limitation — see the Build-to-contract stance). They do
take effect where the provider honors them (4.6, or first-party). We inject per the
contract regardless. The **model** lever (`--model`) has no such gap — fully proven.

## Application timing

Picker changes **queue for the next turn**. The **model** can switch **in-band**
(`set_model`, already shipped in appcloud9.82) for the warm process. **Effort/thoughts**
apply via a **`--resume` respawn** that re-injects `--model` + `--settings` from storage
— the same respawn seam plan-mode toggle uses. On respawn the stored model rides along in
`--model`, so an in-band model switch is never reverted (the bug from the prior round).
The in-band `apply_flag_settings` route for effort/thoughts (no respawn) is a **later
optimization** (not pursued now — it has the same Bedrock-4.8 no-effect limitation as
`--settings`). Apply only at the idle turn boundary, never
mid-stream. **A respawn has user-visible latency** (the stall-watchdog can fire) — render
the "applies next turn" hint *before* kicking the respawn so the blip reads as expected,
not as a hang.

All three pickers should be **openable while a turn is in flight** (queue + "applies next
turn" hint). The model picker's disabled-while-busy dead-click is **already fixed**
(appcloud9.82); mirror that pattern for effort/thoughts.

## Files to modify

References are by symbol; line numbers are approximate and drift — re-locate before editing.

- [src/subprocess.ts](../src/subprocess.ts) —
  - `performInitialize` / `postModelList`: the capability fields already flow —
    `cachedModels = resp.models` is an `any[]` passthrough with no `.map()` (subprocess.ts
    ~773/793), so nothing strips them at runtime. No code change here beyond the type
    widening below; do **not** hunt for a stripping `.map()` — there isn't one.
  - `runTurn`: **remove the THINK/ULTRATHINK prompt-prefix hack** and the `thinkingMode`
    branch; reconcile the `thinkingMode` arg still threaded through `sendMessage` and the
    queued-turn plumbing (remove it).
  - `spawnProcess` (~ln 427): **build launch-injection args from storage** — add
    `--model <stored model>` and `--settings '<json>'` (thinkingDisplay/showThinkingSummaries/
    effort, gated on the selected model's capabilities). The current code intentionally
    omits `--model` and leans on `settings.local.json`; reverse that — drive the model from
    `--model` so the extension's storage wins and the dev's file is left alone.
  - For apply-on-change: reuse the plan-mode respawn seam so a thoughts/effort change at
    idle triggers a `--resume` respawn (which re-injects the flags), or defers to next turn.
- [src/settings.ts](../src/settings.ts) — **stop writing model/effort/thoughts into
  `settings.local.json`.** Keep prefs in extension storage (extend the `claude.selectedModel`
  workspaceState path with `effort` + `thoughtsOn`). Add `getEffort()/setEffort(level)` and
  `getThoughtsOn()/setThoughtsOn(on)`, plus a `buildSettingsArg(model)` helper that returns
  the `--settings` JSON for the selected model (capability-gated). Extend `sendModelConfig`
  (or a new `thoughtControlConfig`) to include the selected model's capability flags +
  current values. (`setLocalModel`/`getLocalModel` may be retired or kept only for an
  explicit "write to project settings" affordance, not the picker path.)
- [src/webview/vscode.ts](../src/webview/vscode.ts) — extend the `modelList` message type
  to carry `supportedEffortLevels?`, `supportsAdaptiveThinking?`, `supportsEffort?` per
  model. Add `MessageToExtension`: `{ type:'setThoughtsDisplay'; on:boolean }` and
  `{ type:'setEffort'; level:string }`; `MessageFromExtension`:
  `{ type:'thoughtControlConfig'; data:{ supportsEffort:boolean; effortLevels:string[]; currentEffort?:string; supportsAdaptive:boolean; thoughtsOn:boolean } }`.
- [src/webview.ts](../src/webview.ts) — route `setThoughtsDisplay` → `settings.setThoughtsDisplay`,
  `setEffort` → `settings.setEffort`.
- [src/webview/components/PromptPane/PromptPane.tsx](../src/webview/components/PromptPane/PromptPane.tsx)
  — add **Effort** and **Thoughts** controls to `right-controls`, styled like the existing
  `connect-menu` pattern. Gate Effort on `supportsEffort`, Thoughts on `supportsAdaptive`.
  **Remove the Ultrathink button** and the `thinkingMode` toggle/plumbing.
- [src/webview/components/ModelSelector/ModelSelector.tsx](../src/webview/components/ModelSelector/ModelSelector.tsx)
  — drop `disabled={busy}` (or replace with openable-while-busy + "applies next turn"),
  consistent with the new pickers.
- [src/webview/components/ThinkingPane/ThinkingPane.tsx](../src/webview/components/ThinkingPane/ThinkingPane.tsx)
  — **always mount on `thinkingBlockStart`** and show the bubble + running timer even when
  no `thinkingDelta`/`thinking` text arrives; relax the empty-content guards
  (`ActiveThinkingPane` returns null on empty text; `commitToPill` early-returns with no
  content). With Thoughts On, render text as today. The elapsed timer (`thinkingStartMs`)
  already exists. *(Verify these seams; line refs from prior analysis.)*
- [src/webview/components/ThinkingPill/ThinkingPill.tsx](../src/webview/components/ThinkingPill/ThinkingPill.tsx)
  — render a timer-only pill (no/disabled expand chevron) when there's no thought text.
- [package.json](../package.json) — **remove** `claudeCodeChat.thinking.intensity`; add
  `claudeCodeChat.thinking.show` (boolean, default `true`) for the Thoughts default and
  optionally `claudeCodeChat.thinking.effort` (string, default unset). **Bump
  `appcloud9.X` to the next version.**
  - **Precedence (spell it out):** the package.json config is the **default/seed**;
    **workspaceState is the live current value and wins** once the user touches a picker.
    Read order: if workspaceState has a value use it, else fall back to the config default,
    else the model's own default. Changing the config later only affects sessions that
    haven't set a workspaceState value.

## Implementation details

### Launch injection (single source of truth in extension storage)

Build the spawn args from storage + the selected model's capability flags. No file writes:

```ts
const args = [ ...base ];
args.push('--model', storedModel);              // verified: overrides settings.local.json

const s: Record<string, unknown> = {};
if (model.supportsAdaptiveThinking) {            // Thoughts toggle
  s.thinkingDisplay = thoughtsOn ? 'summarized' : 'omitted';
  s.showThinkingSummaries = thoughtsOn;
}
if (model.supportsEffort && effort) {            // Effort (omit to inherit default)
  s.effort = effort;                             // always one of supportedEffortLevels
}
if (Object.keys(s).length) args.push('--settings', JSON.stringify(s));
```

No `off/brief/balanced/deep` ladder, no `LEGACY_MAP`, no `settings.local.json` writes —
the pickers expose the model's real axes directly and inject them at launch.

### Always-on pane: decouple "active" from "has text"

On `thinkingBlockStart`, mount the pane and start the timer regardless of text; on the
turn-ending flush, always commit a pill (timer-only if no text). Reuse the existing
`thinkingBlockStart` / `commitToPill` / `flushThinkingToPill` flow — relax the
empty-content guards rather than rewrite it.

### Effort clamp on model switch

The level is stored verbatim. On model change, if the stored level isn't in the new
model's `supportedEffortLevels`, clamp to the nearest (e.g. `xhigh`→`high`, or `max` if
that's the top the new model offers) and re-write on the next spawn.

## Edge cases

- **`--settings` is a merged high-precedence layer**, not a replace — it overrides only
  the keys we inject (model/effort/thoughts), leaving the dev's other `settings.local.json`
  and `settings.json` keys intact. (Optional hard isolation: `--setting-sources` to exclude
  `local`, but unnecessary since flags already win.)
- **Custom/typed-in model id** not in the catalog: capabilities unknown ahead of time —
  fall back to hiding the effort/thoughts controls (or a safe default) until it spawns and
  re-handshakes.
- **Cold start:** before the first `initialize`, the catalog is empty; the controls
  inherit the model picker's existing empty state until the first handshake lands.
- **Off ≠ no feedback:** with Thoughts Off, the bubble + timer still render; confirm the
  thinking block still emits `content_block_start`/`stop` at `display: omitted` (the logs
  in `thoughts_report.md` prove it does).
- **Thoughts On but no text (Bedrock-4.8):** expected, not a bug — the bubble + timer
  render and the "(no thoughts returned for this model/provider)" note shows. The toggle
  stays visible (gated on the advertised `supportsAdaptiveThinking`, which 4.8 reports
  true); we do **not** special-case the provider to hide it.
- **Mid-session change:** injected flags only take effect on the next spawn. Changing
  effort/thoughts queues for next turn and respawns (re-injecting the flags); note any blip.
- **Prefs scope:** workspaceState is per-workspace (model pref is often per-project). If
  the user wants "this model whenever I open the extension" to be global, use globalState
  or a dedicated extension prefs file instead — minor storage choice, not a blocker.

## What we are NOT doing

- **No bundled depth/visibility menu.** Two orthogonal controls (Effort + Thoughts On/Off).
- **No raw/unsummarized thought stream.** `summarized` is the richest display level.
- **No `set_max_thinking_tokens`.** Wrong dial (budget, not display) and coarse on adaptive
  models. (It is *accepted* by the CLI, not rejected — just irrelevant here.)
- **No legacy `budget_tokens` fallback** for non-adaptive models (capability-gated absence
  instead). Deliberate scope decision.
- **No "disable thinking entirely" option.** The Thoughts toggle only controls visibility;
  thinking stays on. (Could be added later as a separate control if wanted.)
- **No StreamParser changes.** It's correct and lights up once `thinking_delta` text returns.
- **No writes to the dev's `.claude/settings.local.json`.** Extension prefs live in
  extension storage and are injected at launch; the dev's file stays for "Claude Code in
  the wild." Deliberate architecture decision.

## Resolved decisions (no open questions)

- Two separate pickers (Effort depth + Thoughts On/Off visibility). ✔
- Thoughts default **On** (summarized); thinking always on; bubble + timer always shown. ✔
- Capability-flag gating; **no** legacy budget fallback. ✔
- **Remove** the Ultrathink button, `thinking.intensity`, and the prompt-prefix hack. ✔
- **Extension-owned storage + launch injection** (`--model` + `--settings`); never write
  the dev's `settings.local.json`. Verified vectors; this also dissolves the model-revert
  bug. ✔
- Apply effort/thoughts via `--resume` respawn first; in-band `apply_flag_settings` as a
  later optimization gated on `diagnostic-ab`. Model switches in-band (shipped). ✔
- Model list/capabilities come from the `initialize` catalog (confirmed). ✔
- **Build to contract** — gate on advertised flags only; the Bedrock-4.8 no-thoughts gap is
  a tracked upstream limitation ([#49268](https://github.com/anthropics/claude-code/issues/49268),
  [#56356](https://github.com/anthropics/claude-code/issues/56356)), not a blocker. ✔

## Gates (both run — proceed)

- `diagnostic-ab`: **DONE, negative on Bedrock-4.8** → resolved via build-to-contract (not a
  blocker). Re-test if the CLI updates or on a first-party provider — the UI will then light
  up with no code change.
- `confirm-capability-fields`: **DONE** — field names confirmed (`value` key;
  `supportsEffort`/`supportedEffortLevels`/`supportsAdaptiveThinking`; no fastMode/autoMode;
  legacy/alias entries carry none → hide).

## Post-build validation (workflow, not a blocker)
- Confirm `thinking_delta` text renders with Thoughts On on a model/provider that honors it
  — i.e. **Opus 4.6** on Bedrock (not 4.8). On **Bedrock-4.8**, verify the graceful path
  instead: bubble + timer render and the "(no thoughts returned…)" note shows.
- Confirm the bubble + timer render on every model regardless of Thoughts state (the
  always-on affordance — the core win, provider-independent).
- Confirm Effort changes are accepted and the menu reflects each model's
  `supportedEffortLevels`; confirm an alias/legacy model (no flags) shows no thinking controls.
- Confirm `--model` launch-injection survives a respawn (model-revert bug fixed).

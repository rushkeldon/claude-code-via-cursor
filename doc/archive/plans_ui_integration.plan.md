---
name: Plans-skill UI integration (plan-phase picker + CCVC card + review breakout)
overview: "Add a Plan-phase picker to the right of the Agent/Plan pill (visible only in Plan mode) that drives the plans-skill lifecycle as a discoverability surface — clicking a phase emits the real /plans verb (or an NL prompt) the user could type themselves. Phases: collaborate (baseline, no-op), write, review, verify, update, build, toCursor. Phase state is ephemeral per-session; only the toCursor handoff table persists (extension storage). A new CCVC card type attributes extension-authored turns (rated difficulty, generated prompts, emitted commands, subagent notices). review can break out to a fresh subagent at a user-chosen model (pre-scrolled by a silent author-rated 1-10 human-SWE difficulty); 'in this session' is always offered. Everything suggests, nothing forces (current-not-fence). CCVC-only — consumes /plans verbs as-is, no skill edits."
todos:
  - id: ccvc-card-type
    content: "Add a 'ccvc' card type to ChatMessage (src/webview/components/ChatMessage/ChatMessage.tsx type union + styling) — header reads 'CCVC', visually distinct from user/claude/system. The reusable primitive for any extension-authored turn."
    status: pending
    phase: "foundation"
  - id: phase-state
    content: "Add ephemeral plan-phase state to src/webview/state/ (new signal, e.g. planPhase + per-plan registry); seeded to 'collaborate' when activeMode flips to 'plan'; wiped on reload/newSession. NOT persisted, NOT in active_modes.md."
    status: pending
    phase: "foundation"
  - id: plans-installed-signal
    content: "Promote plansInstalled to a SHARED signal in src/webview/state/ (it currently lives module-local in SettingsModal.tsx, unreachable from PromptPane). Populate it early — request checkSkillsInstalled on webview ready (not only when Settings opens) so the picker can gate on it from first paint. Point SettingsModal at the shared signal too (dedupe)."
    status: pending
    phase: "foundation"
  - id: phase-pill
    content: "Render the phase picker to the RIGHT of the mode pill in PromptPane.tsx, visible only when plansInstalled === true AND activeMode === 'plan' (graceful degradation: no plans skill → no picker → Plan mode = today's behavior). At rest shows the phase verb; open shows the 7 items with a trailing ellipsis on the dialogue-spawning ones (write… review… verify… update… build… toCursor…), none on collaborate."
    status: pending
    phase: "picker-ui"
  - id: which-plan-dialog
    content: "Build the shared 'which plan' dialogue (new component): lists project *.plan.md (whole-workspace glob, recently-changed desc), reconciled against the handoff table (suppress archived decoys, surface live ~/.cursor/plans copies), editable control for a new/explicit path, verb button bottom-right."
    status: pending
    phase: "picker-ui"
  - id: handoff-table
    content: "Persist the toCursor handoff table in extension storage (src/skills or a new src/plan_handoffs.ts + storageUri): rows {basename, archivedPath, target, livePath, handedOffWhen}. Reconcile-on-read (drop stale rows whose livePath is gone). Written when toCursor runs; read by which-plan-dialog."
    status: pending
    phase: "handoff"
  - id: phase-inline-verbs
    content: "Wire the inline phases that emit text via the existing send path (inject full command string directly, NOT type-simulation — avoids the 188 truncation class): write → generated NL prompt; verify → /plans verify <path>; update → /plans update <path> <report>; toCursor → /plans toCursor <path> <archiveDir>. Each routed through a CCVC card."
    status: pending
    phase: "phases"
  - id: write-dialog
    content: "write's dialogue: agent proposes a plan name (editable) + target path (defaults to plan dir from activeMode, e.g. doc/); on commit, assemble + send an NL write prompt naming the resolved <path>/<name>.plan.md via a CCVC card."
    status: pending
    phase: "phases"
  - id: difficulty-rating
    content: "On opening review/build dialogs, fire a silent author-session turn rating 1-10 'difficulty for the average human software engineer to implement', anchored with exemplars, consequence-blind (don't tell it why). Surface the turn as a CCVC card. Map score → a curated current-models capability ladder (NOT the raw display list with its legacy/1M variants) to pre-scroll the model picker default."
    status: pending
    phase: "review-breakout"
  - id: review-build-dialog
    content: "review & build dialogue: which-plan + a model list whose top entry is 'in this session' and whose model rows are pre-scrolled to the difficulty-rated default (editable, never forced). review caveats (not forbids) the in-session choice re: lost independence. Commit → in-session path (build: two lines '/modes agent' then '/plans build <path>'; review: inline) OR subagent path (spawn at chosen model, Plan-mode-free, seeded prompt)."
    status: pending
    phase: "review-breakout"
  - id: subagent-spawn
    content: "SPIKE + build: confirm the in-session agent can spawn a model-overridden, fresh-context subagent via CCVC's wrapped Claude Code. Branch: if surfaced, use it; if not, build the bridge. Subagent launches free of parent Plan mode, seeded with the review prompt + plan path + output dir; writes the .review.md there."
    status: pending
    phase: "review-breakout"
  - id: review-return
    content: "When the review subagent finishes: it has written .review.md to the chosen dir; emit a CCVC card announcing 'review complete → <path>' plus the verdict gestalt (pointer + gestalt, not full inline)."
    status: pending
    phase: "review-breakout"
  - id: modes-comment-cleanup
    content: "De-vestige src/modes.ts comments: line ~9 'per-project auto-memory directory' → per-session (<session_id>/active_modes.md); line ~14 archived-plan ref. Comment-only; no behavior change. (Flat active_modes.md already deleted this session.)"
    status: pending
    phase: "cleanup"
  - id: bbpi
    content: "Bump appcloud9.X in package.json to the next version, then build, package, install the VSIX (BBPI)."
    status: pending
    phase: "release"
isProject: false
---

# Plans-skill UI integration

## Problem / Context

CCVC now ships with two companion skills (`modes`, `plans`) and detects whether they're
installed ([webview.ts](src/webview.ts) `checkSkillsInstalled`, `plansInstalled`). But the
`plans` skill's rich lifecycle (`review`/`verify`/`toCursor`/`build`/`update`) is invisible
in the UI — a user has to know the verbs and type them. We want to **surface the loop as a
GUI-native affordance** without assuming the skill is present and without obfuscating how it
works: clicking a phase emits the *real* `/plans` verb so the user *learns* it (the vision
doc's "capability parity, translate-don't-reproduce, train-the-human" posture). This deepens
the plan-loop wedge ([doc/ref/vision.md](doc/ref/vision.md) §2) which the vision calls "a
headline, not a footnote."

Design was settled in an extended brainstorm; the governing philosophy is recorded in
[vision.md](doc/ref/vision.md) ("whoever has to keep the promise should be involved in
making it") and a new umbrella principle this plan introduces: **current, not fence** — every
affordance *suggests* and *defaults*; none *restricts*. The user can always swim against the
current.

## Approach

A **second pill** sits to the right of the existing Agent/Plan mode pill, visible **only in
Plan mode** — same control grammar, one scope down (`collaborate` : Plan :: `agent` : modes —
the named default state). It's a **picker** (not a live indicator): the only automatic
behavior is showing it, seeded to `collaborate`, when Plan mode turns on. State flows one
direction — user picks → action fires — so there's no fragile NL-intent detection.

Seven phases. `collaborate` is the inert baseline (no dialogue, no command). The other six
gather input via a **shared dialogue** (which-plan picker + phase-specific fields, verb button
bottom-right) and then **emit text through the normal send path** — a slash command for
verify/update/toCursor/build, a generated NL prompt for write (there is no `/plans write`
verb; authoring is an NL gesture). `review` is special: it can **break out to a fresh
subagent** at a chosen model.

Everything the extension sends on the user's behalf renders under a new **CCVC card** type
(neither "YOU" nor Claude) — the transparency primitive.

Phase state is **ephemeral** (a webview signal, wiped per session), with **one persistent
exception**: the `toCursor` **handoff table** (extension storage), because the
archived-decoy ↔ live-Cursor-copy mapping must survive reload for the which-plan picker to
suppress the decoy and surface the live copy.

Key existing anchors: the mode pill + `activeMode` signal live in
[PromptPane.tsx](src/webview/components/PromptPane/PromptPane.tsx) (`mode-dropdown-wrapper`,
~line 608) fed by [state/settings.ts](src/webview/state/settings.ts) (`activeMode`,
`modeItems`, ~line 81); the model picker is
[ModelSelector.tsx](src/webview/components/ModelSelector/ModelSelector.tsx) + `modelList`
signal; card types are the union in
[ChatMessage.tsx](src/webview/components/ChatMessage/ChatMessage.tsx) line 7;
[modes.ts](src/modes.ts) mirrors the per-session `active_modes.md` (path-agnostic, follows the
skill).

## Conventions & assumptions

- **The skills are OPTIONAL — graceful degradation is the whole gate.** `modes`/`plans` may
  not be installed. The phase picker is shown **iff `plansInstalled === true`**; absent the
  skill, Plan mode behaves exactly as today (mode pill + NL collaboration, no picker). There is
  **no customization, no Settings surface, no per-phase show/hide or prompt override** — present
  the full 7-phase picker when the skill is there, nothing when it isn't. The picker is, in
  effect, the reward for installing the skill. (`plansInstalled` detection already exists in
  [webview.ts](src/webview.ts) `checkSkillsInstalled`; the gap is that it isn't yet a shared
  webview signal — see the `plans-installed-signal` todo.)
- **CCVC-only, consume `/plans` as-is.** No edits to the `plans` SKILL.md. The
  "recommended-model-in-report" idea is explicitly dropped. We dogfood, then release to a
  trusted bug-bash group.
- **current, not fence.** Every dialogue defaults/suggests and is fully overridable. `review`'s
  in-session option is *offered with an honest caveat* about lost independence — informed, not
  steered. Nothing is forbidden.
- **Send-path safety (load-bearing).** The picker must inject the **full assembled command
  string directly** into the send flow, never simulate typing into the textarea — the
  textarea/terminal-mode path is what truncated `/plans build /Users/...` → `/plans build`
  twice (fixed for paste in appcloud9.188). All phase-emitted text (slash commands AND the
  write NL prompt, both path-bearing) routes the safe way. If the only available injection is
  the textarea path, that's a STOP-and-surface.
- **Phase labels are the skill verbs** (`collaborate`/`write`/`review`/`verify`/`update`/
  `build`/`toCursor`), honoring the skill's casing (`toCursor` camelCase). `collaborate` and
  `write` are house-added (not real verbs) — `collaborate` emits nothing, `write` emits an NL
  prompt. Watching the menu teaches the real verb spellings.
- **Difficulty rater is the current author session** (NOT a fresh instance): it has unstated
  in-context nuance a blind rater lacks, and skips a codebase-onboarding token burn. The
  optimism-bias cost is acceptable because the rating only *pre-scrolls* a default the user
  overrides. Rating is consequence-blind ("rate difficulty," never "to pick an implementer").
- **Difficulty→model ladder is a curated list of CURRENT models**, separate from the picker's
  display list — the display list interleaves legacy versions and 1M-context variants
  (Opus 4.7/4.6, *(1M context)*) that aren't a clean capability rank. Assumes a small ordered
  ladder (e.g. Haiku → Sonnet → Opus → Fable); if the model lineup changes, the ladder updates,
  not the mapping logic.
- **Handoff store is extension storage** (private, survives reload; does NOT travel with the
  repo — acceptable). `target` field is generic (`cursor` today; room for `intellij` later) so
  a future `toIntelliJ` reuses the same table.
- **Plan search is whole-workspace** `*.plan.md` glob (minus archive dir), required so the
  handoff table can resolve to out-of-project `~/.cursor/plans/` copies. (A Settings ignore-glob
  is a deferred nice-to-have, NOT in this plan.)
- **toCursor in Plan mode is fine** (observed): it only `cp`/`mv`s a `.plan.md`, not a
  non-markdown content write, so Plan-mode write rules don't balk. **build** is the only verb
  that truly fights Plan mode (it edits code) — handled via the model choice (see build step).

## The steps

### foundation

1. **`ccvc-card-type`** — in [ChatMessage.tsx](src/webview/components/ChatMessage/ChatMessage.tsx),
   add `'ccvc'` to the `type` union (line 7) and a matching visual treatment (header label
   "CCVC", its own accent — mirror how `system`/`error` are styled). WHY: the transparency
   primitive every extension-authored turn renders under; "YOU" would be a lie, Claude's output
   it isn't. DONE-WHEN: a message rendered with `type="ccvc"` shows a "CCVC" header, visually
   distinct from user and claude cards.

2. **`phase-state`** — in [state/settings.ts](src/webview/state/settings.ts) (or a new
   `state/plan_phase.ts`), add an ephemeral `planPhase` signal + a per-plan map
   `{ planPath → phase }`. Seed `collaborate` when `activeMode` becomes `'plan'`; clear on
   `ready`/`newSession` (mirror how `queuedItems` resets). WHY: the picker reflects what the
   user last picked, per plan, for this session only. DONE-WHEN: entering Plan mode shows
   `collaborate`; reload resets to `collaborate`; it never writes a file.

### picker-ui

3. **`phase-pill`** — in [PromptPane.tsx](src/webview/components/PromptPane/PromptPane.tsx),
   render a second pill immediately right of `mode-dropdown-wrapper` (~line 608), gated on
   `activeMode.value === 'plan'`. At rest: the current phase verb. Open: the 7 items, trailing
   ellipsis on dialogue-spawners (`write…`/`review…`/`verify…`/`update…`/`build…`/`toCursor…`),
   none on `collaborate`. Reads visually as `Plan | collaborate`. WHY: the discoverability
   surface; same grammar as the mode pill. DONE-WHEN: in Plan mode a second pill appears showing
   `collaborate`; opening it lists all 7 with correct ellipses; in Agent mode it's absent.

4. **`which-plan-dialog`** — new component (e.g. `components/PlanPicker/`). Inputs: the verb, an
   optional phase-specific field set. Body: project `*.plan.md` (whole-workspace glob via a new
   host message, recently-changed desc), reconciled against `handoff-table` (hide archived
   decoys, show live `~/.cursor/plans/` copies labeled as such); an editable control to type a
   new/explicit path; verb button bottom-right. WHY: "which plan?" is the spine — you routinely
   have 1–3 plans in scope, so singular-"the plan" is usually wrong. DONE-WHEN: opening any
   dialogue-spawning phase lists the in-scope plans newest-first, lets you pick or type a path,
   and never offers an archived decoy when a live Cursor copy exists.

### handoff

5. **`handoff-table`** — new `src/plan_handoffs.ts` (host), persisted under `storageUri` (like
   permissions/locks). API: `record({basename, archivedPath, target, livePath})`, `list()`
   with **reconcile-on-read** (drop rows whose `livePath` no longer exists — don't trust a stale
   record, the lesson from this session's anchor/YAML work). Written when `toCursor` completes;
   surfaced to the webview for `which-plan-dialog`. WHY: the decoy↔live mapping must outlive the
   session that did the handoff. DONE-WHEN: after a toCursor, the picker shows the live Cursor
   copy (not the `doc/archive/` decoy) in a *fresh* session; a manually-deleted live copy drops
   from the list rather than erroring.

### phases

6. **`phase-inline-verbs`** — wire verify/update/toCursor to assemble their full `/plans <verb>
   <args>` string from the dialogue result and **inject it directly into the send path** (the
   safe injection, not textarea simulation), rendered as a CCVC card. WHY: these are real verbs;
   emitting them visibly trains the user and runs the actual skill. DONE-WHEN: picking verify on
   a chosen plan sends `/plans verify <abs-path>` intact (full path survives — guard against the
   188 truncation class) under a CCVC card.

7. **`write-dialog`** — `write`'s dialogue proposes an (editable) plan **name** + **path**
   (default = plan dir from `activeMode`'s `plan: <dir>`, e.g. `doc/`); commit assembles an NL
   prompt ("Write the plan we discussed to `<path>/<name>.plan.md` …") and sends it via a CCVC
   card. WHY: `write` creates a new file (no existing plan to pick), and the name wants settling
   up front. DONE-WHEN: picking `write` with no name proposes one, lets you edit name+path, and
   sends a path-bearing NL write prompt under a CCVC card.

### review-breakout

8. **`difficulty-rating`** — on opening review/build dialogs, fire a **silent author-session
   turn** ("On a scale of 1–10, how difficult would this be for the average human software
   engineer to implement?" + exemplar anchors; do NOT mention model-picking), surfaced as a CCVC
   card. Map the score onto the **curated capability ladder** to pre-scroll the model picker's
   default. WHY: a consequence-blind difficulty estimate is a question models answer well (vs.
   self-fitness, which they don't); statelessness keeps it ungameable across calls. DONE-WHEN:
   opening review/build shows a CCVC card with the rating and the model picker is pre-scrolled to
   the ladder-mapped default (overridable).

9. **`review-build-dialog`** — the dialogue: which-plan + a model list whose **top item is "in
   this session"** and whose model rows are pre-scrolled per the rating. Commit:
   - **in this session** → fire inline. `build` emits **two lines**: `/modes agent` then
     `/plans build <path>` (the mode-exit is visible sent text, not a silent flip). `review`
     inline runs in the current context — offered with an honest caveat ("the plan's author
     reviewing its own work misses what fresh eyes catch"), never forbidden.
   - **a model** → the subagent path (step 10).
   WHY: current-not-fence — suggest the fresh-reviewer default, allow the in-session escape.
   DONE-WHEN: picking "in this session" for build sends the two-line command; picking a model
   triggers a subagent; review's in-session option shows its caveat.

10. **`subagent-spawn`** (SPIKE → build) — **first determine** whether CCVC's wrapped Claude Code
    lets the in-session agent spawn a **model-overridden, fresh-context** subagent. **Branch:**
    (a) supported → use it; (b) not → build the bridge as part of this todo (surface the
    capability). The subagent launches **free of the parent's Plan mode**, seeded only with the
    review prompt + plan path + output dir. WHY: independence requires fresh context; the chosen
    model requires override; this is the one genuine technical unknown. DONE-WHEN: clicking a
    model in the review dialog runs a review in a fresh context at that model and writes a report
    — confirmed by the report file appearing, not just "no error."

11. **`review-return`** — on subagent completion, emit a CCVC card: "review complete → `<path>`"
    plus the verdict **gestalt** (pointer + one-line, not the full report inline). WHY: closes
    the loop visibly; the user reads the file or runs `/plans update`. DONE-WHEN: a finished
    review surfaces a CCVC card naming the written `.review.md` and its gestalt.

### cleanup

12. **`modes-comment-cleanup`** — in [modes.ts](src/modes.ts), fix the stale comments: line ~9
    "per-project auto-memory directory" → per-session (`<session_id>/active_modes.md`); line ~14
    drop/repoint the archived-plan reference. **Comment-only, zero behavior change** (the code
    already follows the skill's discovered path; the flat `active_modes.md` was deleted this
    session). WHY: a future reader of modes.ts shouldn't be told a stale per-project/flat model.
    DONE-WHEN: modes.ts comments describe the per-session model; no code diff beyond comments.

### release

13. **`bbpi`** — bump `appcloud9.X` in [package.json](package.json) to the **next** version,
    `npm run compile`, `npx @vscode/vsce package --no-dependencies`,
    `cursor --install-extension <vsix> --force`. DONE-WHEN: new VSIX installs; version
    incremented.

## Out of scope

- **No `plans` SKILL.md edits.** Consume verbs as-is; the recommended-model-in-report idea is
  dropped. (Different repo; this plan is single-repo CCVC.)
- **No picker customization.** The picker is binary on `plansInstalled` — full 7 phases or
  nothing. No Settings checkboxes, no per-phase show/hide, no custom per-phase prompt override.
  A user who wants a custom prompt types the verb (which the feature is teaching them anyway).
- **No Settings ignore-glob** for plan search (deferred nice-to-have).
- **No persistence of phase state** — only the handoff table persists. Don't add a `MEMORY.md`
  pointer or a flat file.
- **Don't touch the mode passthrough fields** (`modes.planCommand`/`modes.agentCommand`) — no
  skill-name coupling, already correct.
- **Don't reproduce the difficulty rating as a binding decision** — it only pre-scrolls a
  default. No "the AI recommends X" authority labeling.
- **Don't fix the AskUserQuestion radio-deselect bug here** (separate component bug noted this
  session) — out of scope for this feature.
- **Don't edit `doc/archive/*`.**

## Verification

- **With `plans` NOT installed**, Plan mode shows NO phase picker — behaves exactly as today.
  With it installed, the picker appears. (Toggle by uninstalling/installing or mocking
  `plansInstalled` to confirm both branches.)
- In Plan mode (skill installed), a second pill shows right of the mode pill, defaulting to
  `collaborate`; absent in Agent mode; resets to `collaborate` on reload.
- Picking verify/update/toCursor on a chosen plan sends the correct `/plans <verb> <abs-path>`
  **with the full path intact** (the truncation guard), under a CCVC card.
- Picking write proposes/edits a name+path and sends a path-bearing NL write prompt (CCVC card).
- `toCursor` records a handoff row; in a fresh session the which-plan picker shows the **live
  Cursor copy**, not the archived decoy; a deleted live copy drops from the list.
- Opening review/build shows a CCVC difficulty-rating card and a pre-scrolled, overridable model
  picker with "in this session" on top.
- `build` "in this session" sends `/modes agent` then `/plans build <path>` (two lines); a chosen
  model spawns a Plan-mode-free subagent that writes a `.review.md` and returns a CCVC gestalt
  card.
- `npm run compile` clean; `grep` shows no stray "YOU"-attribution of extension-sent turns.
- **Escape hatch:** if subagent model-override is NOT surfaceable (step 10b) and the bridge
  proves larger than a focused build, STOP and surface — don't ship a half-wired review breakout;
  the inline/`in this session` path still delivers value alone.

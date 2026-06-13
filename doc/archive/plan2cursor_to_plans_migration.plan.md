---
name: Migrate plan2cursor references to plans
overview: "Rename every plan2cursor reference in CCVC to the new plans skill (plans@skills-anthropic). Keep the one-click install model exactly as-is — just swap the marketplace id, rename the plan2cursorInstalled payload field to plansInstalled across host senders and webview consumers, update FirstRun/Settings copy, and rewrite the CLAUDE.md plan2cursor + build2plan workflow sections to the plans verbs. No new verb UI, no install-flow redesign."
todos:
  - id: install-cmd
    content: "In src/webview.ts installRecommendedSkills(), change the plugin install id and log text from plan2cursor@skills-anthropic to plans@skills-anthropic"
    status: pending
    phase: "code"
  - id: firstrun-prompt-detect
    content: "In src/webview.ts firstRunPrompt sender (~line 287): rename plan2cursorInstalled var, swap the installed_plugins.json key to plans@skills-anthropic, and update the posted data field to plansInstalled"
    status: pending
    phase: "code"
  - id: check-skills-detect
    content: "In src/webview.ts checkSkillsInstalled() (~line 1620): rename plan2cursorInstalled, swap the plugin key + the filesystem-fallback path (~/.claude/skills/plans/SKILL.md), and post plansInstalled in the skillsStatus payload"
    status: pending
    phase: "code"
  - id: firstrun-component
    content: "In src/webview/components/FirstRun/FirstRun.tsx: rename the signal field, the skill-row name+desc, the badge condition, and the two button-gating conditions from plan2cursor(Installed) to plans(Installed)"
    status: pending
    phase: "code"
  - id: settings-component
    content: "In src/webview/components/SettingsModal/SettingsModal.tsx: rename the skillsStatus signal field and rewrite the plan2cursor skill row (label, description, checkmark condition) to plans"
    status: pending
    phase: "code"
  - id: compile-verify
    content: "Run npm run compile; grep the whole src/ tree to confirm zero plan2cursor / plan2cursorInstalled references remain"
    status: pending
    phase: "verify"
  - id: claudemd-docs
    content: "Rewrite the CLAUDE.md 'Plan workflow (plan2cursor + execution)' and 'build2plan' sections to the plans verbs (toCursor archives by itself; build2plan = toCursor then build)"
    status: pending
    phase: "docs"
  - id: vision-doc
    content: "Update the two plan2cursor mentions in doc/ref/vision.md to plans"
    status: pending
    phase: "docs"
  - id: bbpi
    content: "Bump appcloud9.X in package.json, then build, package, and install the VSIX (BBPI)"
    status: pending
    phase: "release"
isProject: false
---

# Migrate plan2cursor references to plans

## Problem / Context

The standalone `plan2cursor` skill has been deleted/uninstalled and replaced by a
significant upgrade: a new **`plans`** skill (a single `/plans <verb>` dispatcher with
five lifecycle verbs — `review`, `verify`, `toCursor`, `build`, `update`). CCVC still
references the old `plan2cursor` skill in its install path, install-detection, first-run
UI, settings UI, and workflow docs. Those references are now stale: the marketplace
plugin id changed (`plan2cursor@skills-anthropic` → `plans@skills-anthropic`), and the
behavior the docs describe is now subsumed by the `plans` verbs.

This migration is a **rename-through**, not a redesign. Two product decisions are
already locked (do NOT revisit them while executing):

1. **Keep the one-click install model exactly as-is.** CCVC continues to shell out to
   the user's `claude` CLI (`claude plugin install …@skills-anthropic`) on the "Install
   Skills" button. We are NOT switching to a "here's a command / link, install it
   yourself" model, and NOT redesigning the FirstRun/Settings install flow.
2. **No new verb UI.** Surfacing the `plans` verbs (`build`, `toCursor`, etc.) as panel
   buttons/commands is under consideration but explicitly OUT of scope here.

## Approach

Two independent footprints, migrated together:

- **Code (real hard dependency).** The install path hard-codes `plan2cursor@skills-anthropic`
  and carries a `plan2cursorInstalled` boolean that flows host → webview in three message
  payloads (`firstRunPrompt`, `skillsStatus`) and is consumed by two components. Rename the
  marketplace id to `plans@skills-anthropic`, the payload field to `plansInstalled`, the
  detection key + filesystem-fallback path, and all UI labels/copy. The mode-command
  passthrough fields (`modes.planCommand` / `modes.agentCommand` in
  [SettingsModal.tsx](src/webview/components/SettingsModal/SettingsModal.tsx)) are NOT
  touched — they're blind passthrough strings with no skill-name coupling.
- **Docs.** Rewrite the [CLAUDE.md](CLAUDE.md) `plan2cursor` workflow + `build2plan` recipe
  to the `plans` verbs, and fix two stale mentions in
  [doc/ref/vision.md](doc/ref/vision.md).

The relevant skill source for verb semantics is the installed
`plans` SKILL.md (`~/.claude/plugins/cache/skills-anthropic/plans/1.0.0/skills/plans/SKILL.md`);
the doc rewrites should match its verb definitions.

## Conventions & assumptions

- **Payload field is `as any`, NOT in the typed protocol union.** `firstRunPrompt`,
  `skillsStatus`, `skillInstallResult`, `installRecommendedSkills`, `checkSkillsInstalled`
  are all sent/handled via `as any` — none appear in the `MessageToExtension` /
  `MessageFromExtension` unions in [vscode.ts](src/webview/vscode.ts). **Consequence:**
  the compiler will NOT catch a missed `plan2cursorInstalled` → `plansInstalled` rename.
  The host sender and the webview consumer must be renamed in lockstep, and the
  grep in `compile-verify` is the real safety net — do not rely on `tsc` to flag a miss.
- **Marketplace id format:** `plans@skills-anthropic` (mirrors the existing
  `modes@skills-anthropic`). The marketplace itself (`rushkeldon/skills-anthropic`,
  added in `installRecommendedSkills`) is unchanged.
- **Filesystem-fallback path** in `checkSkillsInstalled` is `~/.claude/skills/<name>/SKILL.md`
  — so the new path is `~/.claude/skills/plans/SKILL.md`.
- **Naming:** match the existing `modesInstalled` style — the new field is `plansInstalled`
  (not `plansSkillInstalled` or similar).
- Assumes the `plans` plugin is published to `skills-anthropic` under the id `plans`. If
  the published id differs, `install-cmd`, `firstrun-prompt-detect`, and
  `check-skills-detect` all change to that id.

## The steps

### code

1. **`install-cmd`** — in [webview.ts](src/webview.ts) `installRecommendedSkills()`, the
   third nested `cp.execFile` (anchor: the `["plugin", "install", "plan2cursor@skills-anthropic", "-s", "user"]`
   array). Change the install id to `plans@skills-anthropic`; change the log message
   `"plan2cursor install failed"` → `"plans install failed"`. WHY: the old plugin no
   longer exists in the marketplace. DONE-WHEN: the only `plugin install` ids in the file
   are `modes@skills-anthropic` and `plans@skills-anthropic`.

2. **`firstrun-prompt-detect`** — in [webview.ts](src/webview.ts), the `firstRunPrompt`
   sender (anchor: the block declaring `let plan2cursorInstalled = false;` near the
   `installedPluginsPath` read, ~line 287). Rename the local to `plansInstalled`, swap the
   detection key `plugins["plan2cursor@skills-anthropic"]` → `plugins["plans@skills-anthropic"]`,
   and change the posted `data: { modesInstalled, plan2cursorInstalled }` →
   `{ modesInstalled, plansInstalled }`. WHY: the firstRunPrompt payload carries install
   state to the FirstRun modal. DONE-WHEN: this function references only `plans`, never
   `plan2cursor`.

3. **`check-skills-detect`** — in [webview.ts](src/webview.ts) `checkSkillsInstalled()`
   (anchor: the function declaring `let plan2cursorInstalled = false;` ~line 1620). Rename
   the local, swap the `installed_plugins.json` key to `plans@skills-anthropic`, change the
   filesystem-fallback `path.join(homedir, ".claude", "skills", "plan2cursor", "SKILL.md")`
   → `"plans"`, and post `data: { modesInstalled, plansInstalled }`. WHY: this drives the
   Settings checkmark + FirstRun re-check after install. DONE-WHEN: the function references
   only `plans`.

4. **`firstrun-component`** — in [FirstRun.tsx](src/webview/components/FirstRun/FirstRun.tsx):
   (a) the `skillsData` signal type field `plan2cursorInstalled: boolean` and the two
   default-object literals (`on("firstRunPrompt"…)` fallback); (b) the skill row (anchor:
   `<span class="first-run-skill-name">plan2cursor</span>`) — rename to `plans`, and update
   its description to reflect the broader lifecycle (e.g. "Plan lifecycle: review, verify,
   send to Cursor, build, and update a .plan.md"); (c) the badge condition
   `data?.plan2cursorInstalled`; (d) the two button-gating expressions
   (`!data?.plan2cursorInstalled` in the install-button guard, and
   `data?.plan2cursorInstalled` in the Done/Skip label). WHY: the modal lists the
   recommended skills and gates the install button on their state. DONE-WHEN: the modal
   renders a `plans` row and the file has no `plan2cursor` token.

5. **`settings-component`** — in [SettingsModal.tsx](src/webview/components/SettingsModal/SettingsModal.tsx):
   (a) the `skillsStatus` signal type field `plan2cursorInstalled: boolean` (~line 483);
   (b) the skill row (anchor: `<span class="permission-tool">plan2cursor</span>`) — rename
   the label to `plans`, update the description from "Send plans to Cursor's plans panel"
   to cover the lifecycle (e.g. "Review, verify, send to Cursor, build, and update plans"),
   and rename the `status.plan2cursorInstalled` checkmark condition. WHY: the Settings
   Skills section mirrors FirstRun's install state. DONE-WHEN: the Skills section shows a
   `plans` row and the file has no `plan2cursor` token.

### verify

6. **`compile-verify`** — run `npm run compile` (tsc + vite must both pass). Then
   `grep -rn "plan2cursor" src/` MUST return zero hits. WHY: the field rename isn't
   compiler-enforced (it's `as any`), so grep is the real check — a stray
   `plan2cursorInstalled` on one side of the host/webview boundary would silently read
   `undefined` and mis-render the badge. DONE-WHEN: clean build AND empty grep over `src/`.

### docs

7. **`claudemd-docs`** — in [CLAUDE.md](CLAUDE.md), rewrite two sections:
   - `### Plan workflow (`plan2cursor` + execution)` (~line 80) — retitle to the `plans`
     workflow. The standalone "**Archive the original**" rule (line 84) is now redundant:
     `/plans toCursor` archives the original *itself* as part of the verb. Reframe to:
     "`/plans toCursor` copies into `~/.cursor/plans/` AND archives the repo original; the
     Cursor copy is now canonical — edit it, not the archive." Keep the "Keep the todos
     accurate at every step" rule (still true; `/plans build` flips statuses live).
   - `### build2plan [path to plan.md]` (~line 93) — `build2plan` is no longer a bespoke
     recipe; it's verb composition. Rewrite as: "`build2plan` = `/plans toCursor <path>`
     then `/plans build <cursor-path>` — the caller composes; no auto-chaining." Drop the
     now-duplicated archive sub-step (toCursor owns it).

     WHY: the docs must teach the new verbs, not a deleted skill. DONE-WHEN: CLAUDE.md
     names `plans`/`toCursor`/`build` and no longer instructs invoking a `plan2cursor`
     skill. (Note: the existing "Plans must not hard-code a version" rule and the live-todo
     status rules stay — they're skill-agnostic.)

8. **`vision-doc`** — in [doc/ref/vision.md](doc/ref/vision.md), update the two
   `plan2cursor` mentions (~lines 32, 73) to `plans`. WHY: keep the vision doc consistent.
   DONE-WHEN: no `plan2cursor` in vision.md.

### release

9. **`bbpi`** — bump `appcloud9.X` in [package.json](package.json) to the **next** version,
   `npm run compile`, `npx @vscode/vsce package --no-dependencies`, then
   `cursor --install-extension <vsix> --force`. WHY: ship the migrated build. DONE-WHEN:
   the new VSIX installs successfully and the version is incremented.

## Out of scope

- **Do NOT add verb-invoking UI** (buttons/commands for `build`, `toCursor`, `review`,
  `verify`, `update`). That's a separate, still-under-consideration design.
- **Do NOT redesign the install flow** — keep the one-click `claude plugin install`
  model, the FirstRun modal structure, and the Settings Skills-section mechanism as they
  are. Only labels/ids/field-names change.
- **Do NOT touch the mode passthrough fields** (`modes.planCommand` / `modes.agentCommand`)
  — they have no skill-name coupling and already work.
- **Do NOT edit `doc/archive/*`** (e.g. `claude_code_parity.plan.md`,
  `punchlist_2.plan.md`) — archived plans are historical snapshots; leave their
  `plan2cursor` mentions intact.
- **Do NOT modify the typed message unions** in `vscode.ts` to add these messages — they're
  intentionally `as any`; this migration preserves that, it doesn't fix it.

## Verification

- `grep -rn "plan2cursor" src/` → zero hits; `grep -rn "plan2cursor" CLAUDE.md doc/ref/vision.md`
  → zero hits (archives excluded).
- `npm run compile` passes (tsc + vite).
- Behavioral: open the FirstRun modal (reset via Settings → "Reset First-Run") — it lists
  `modes` and `plans` rows; the "Install Skills" button triggers
  `claude plugin install plans@skills-anthropic`; after install the badge flips to ✓.
  Settings → Skills shows the same `plans` row with a working checkmark/Install state.
- **Escape hatch:** if the published plugin id isn't `plans@skills-anthropic` (e.g. the
  marketplace uses a different slug), STOP and confirm the real id before finishing the
  code todos — every detection key depends on it.

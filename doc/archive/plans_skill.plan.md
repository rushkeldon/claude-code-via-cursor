---
name: "/plans skill — package plan lifecycle verbs (review, verify, toCursor, build, update)"
overview: "Consolidate plan2cursor + the project-local build2plan recipe into one namespaced /plans skill, modeled on /modes' subcommand-dispatch design. Five verbs forming a producer/consumer loop over a *.plan.md: review (vet quality → report), verify (QA todo-status accuracy vs reality → report card), toCursor (place in Cursor + archive original), build (execute, flip todos live), update (apply a review/verify report back into the plan). build/verify/review/update are Cursor-agnostic (portable to IntelliJ etc.); only toCursor is vendor-coupled. Verbs are independent atoms — the caller composes (no auto-chaining). The skill is GLOBAL (runs in all Claude Code sessions + Desktop), distributed through the skills-anthropic marketplace. Redistribution (DECIDED, changed from SBS): once both skills are built and the old plan2cursor is deleted, install /plans + modes directly across all targets/surfaces in one combined pass (no step-by-step SBS gating)."
todos:
  - id: design-dispatch
    phase: "Phase 1 — Design"
    content: "Lock the /plans dispatch design mirroring /modes: one SKILL.md, dispatch on first arg (review|verify|toCursor|build|update). Define each verb's signature, args, and one-line blurb. Confirm camelCase verb idiom (toCursor) and that unknown/blank verb prints a help cheat-sheet."
    status: pending
  - id: design-report-contract
    phase: "Phase 1 — Design"
    content: "Define the report-card format that review + verify WRITE and update READS — the coupling that makes update deterministic. Decide: structured-enough markdown (e.g. per-todo findings keyed by todo id + a verdict line) so update can apply findings surgically without re-deriving intent. This is the key open question; resolve before authoring."
    status: pending
  - id: verb-review
    phase: "Phase 2 — Author verbs"
    content: "Author /plans review [plan.md] [out.md]: vet the plan's QUALITY (not its state). Rubric: execution-readiness (unresolved open questions?), stale assumptions (refs to changed files/APIs?), cross-surface/regression risk (does a todo edit shared/global code without a degrade path?), TODO hygiene (atomic/verifiable/ordered/dep-correct?), and mechanical lint (frontmatter YAML validity incl. quoted overview, no hard-coded version, unique todo ids). Write a report card to out.md."
    status: pending
  - id: verb-verify
    phase: "Phase 2 — Author verbs"
    content: "Author /plans verify [plan.md] [out.md]: the taskmaster. For each todo, check whether its recorded status matches REALITY in the codebase — a 'completed' todo must be actually done (file exists / tests pass / behavior confirmed), not done on faith ('compiles' != 'works', per CLAUDE.md). Produce a report card to out.md grading each todo: status-accurate / overclaimed / unverifiable, with evidence."
    status: pending
  - id: verb-tocursor
    phase: "Phase 2 — Author verbs"
    content: "Port plan2cursor into /plans toCursor [plan.md] [archiveDir?]: copy plan into ~/.cursor/plans/ (collision-bump, never overwrite), open in Cursor, AND archive the repo original into archiveDir (default doc/archive/). Archiving lives HERE because this is the verb that creates the duplicate — the whole reason to archive. Carry over plan2cursor's live-status protocol + denied-tools fallbacks."
    status: pending
  - id: verb-build
    phase: "Phase 2 — Author verbs"
    content: "Author /plans build [plan.md]: execute the plan AT path as the live file — implement each todo, flip status pending->in_progress->completed immediately and never batched, surgical status-line edits only (don't churn frontmatter/UUIDs). NO Cursor, NO copy, NO archive — pure execution, so it's portable (Cursor copy, IntelliJ native panel, or plain repo file). This is the platform-agnostic core."
    status: pending
  - id: verb-update
    phase: "Phase 2 — Author verbs"
    content: "Author /plans update [plan.md] [source.md]: consume a review/verify report card (source.md) and apply its findings back into the plan — correct overclaimed statuses, add/adjust todos, fix flagged staleness. Surgical edits only. The riskiest verb (writes the plan from prose) — relies on the report-contract from design-report-contract being structured enough to apply deterministically. Independent atom: never auto-runs review/verify; the user hands it a report."
    status: pending
  - id: package-skill
    phase: "Phase 3 — Package"
    content: "Build the /plans skill package mirroring the skills-anthropic layout: plans/code/skills/plans/SKILL.md + plans/code/.claude-plugin/plugin.json, plus chat/ and cowork/ surface variants as the other skills have. Preserve cross-surface portability (the no-auto-memory / surface-branch patterns) so verbs degrade gracefully off-CCVC."
    status: pending
  - id: marketplace-register
    phase: "Phase 3 — Package"
    content: "Add the /plans plugin to skills-anthropic/.claude-plugin/marketplace.json. Decide the fate of the standalone plan2cursor entry: deprecate/alias to /plans toCursor, or keep both during transition. Document the migration so existing /plan2cursor users aren't stranded."
    status: pending
  - id: claudemd-retire-build2plan
    phase: "Phase 3 — Package"
    content: "Retire the build2plan mini-skill prose from this project's CLAUDE.md, replacing it with a pointer to /plans build (+ /plans toCursor). Keep CLAUDE.md's plan-workflow rules (archive-original, live-todo-updates) since the verbs reference them."
    status: pending
  - id: redistribute
    phase: "Phase 4 — Redistribute"
    content: "DECISION CHANGED (was SBS/proper-channels-only; now: install directly everywhere once built). After BOTH skills are built and the OLD plan2cursor is DELETED, install /plans across ALL targets/surfaces — Claude Code (marketplace via the skills-anthropic plugin) AND Claude Desktop (its install path) — in the SAME combined pass as the modes skill (modes_skill.plan.md's redistribute todo). Verify the verbs resolve on each surface; confirm deleting plan2cursor didn't strand anything (alias or migrate /plan2cursor users to /plans toCursor)."
    status: pending
isProject: false
---

# /plans skill — package plan lifecycle verbs

## Background

Two plan-related capabilities exist today, loosely:

- **`plan2cursor`** — a real skill (`skills-anthropic/plan2cursor`) that copies a
  `.plan.md` into `~/.cursor/plans/` and opens it.
- **`build2plan`** — a *prose mini-skill* in this project's
  [CLAUDE.md](../CLAUDE.md): plan2cursor → archive original → implement keeping
  TODOs live. It's documentation, not a packaged skill.

The user wants these consolidated into one **namespaced `/plans` skill** modeled on
`/modes`' subcommand-dispatch design — the corrected `/modes <verb>` form
(`/modes plan ./doc`, `/modes list`), NOT the old `/enterMode`/`/exitMode` spellings
that the modes-skill plan deletes. So `/plans <verb>` (`/plans build`,
`/plans toCursor`, …) is the sibling idiom. The driving reason is **modularity**:
`/plans build` (pure
execution) is useful *outside* Cursor — e.g. the future IntelliJ plugin's native
plan panel (see [doc/future/intellij_idea_plugin_port.plan.md](future/intellij_idea_plugin_port.plan.md)).
Only `toCursor` is vendor-coupled.

### The five verbs form a producer/consumer loop (not a sprawl)

```
   review ─┐                                                        
   verify ─┴─▶ out.md ─▶ update ─▶ corrected plan ─▶ toCursor ─▶ build
   (produce report)     (consume report)            (place)      (execute)
```

- **review** and **verify** are the *producers* — they read a plan and write a
  report card to `out.md`. They differ in WHAT they judge (see below).
- **update** is the *consumer* — the only writer-back; it applies a report to the
  plan. Without it, reports are dead-ends hand-applied by the user.
- **toCursor** and **build** are the *mechanical* handoff + execution verbs.

This closed loop is why five verbs cohere rather than dilute — each pulls weight,
and the set is complete (vet → place → execute, with a correction path).

### review vs verify — the critical distinction

They answer different questions and must not be conflated:

- **`review` = "Is this plan any good?"** — judges the spec *as written*:
  readiness, stale assumptions, regression risk, TODO hygiene, frontmatter lint. (A
  plan can be well-reviewed but its statuses still lie.)
- **`verify` = "Does the recorded state match reality?"** — the taskmaster. Audits
  each todo's `status` against the codebase: a `completed` todo must be *actually*
  done (file exists / tests pass / behavior confirmed), per CLAUDE.md's
  "'compiles' != 'works'; don't mark complete on faith." (A plan can be perfectly
  reasonable but riddled with overclaimed `completed`s.)

## Approach

One `/plans` skill, `SKILL.md` dispatching on the first arg, mirroring `/modes`'
structure (verb table, blurbs, help cheat-sheet, surface-degradation branches).
Verbs are **independent atoms** — the caller composes; no verb auto-runs another.
The old one-shot `build2plan` becomes `toCursor X` then `build <cursor-path>`,
composed by the caller.

**Responsibility assignment principle:** *archiving exists because `toCursor`
creates a duplicate.* So archive lives on `toCursor` (with an optional `[archiveDir]`
param, default `doc/archive/`), and `build` stays pure execution — which is exactly
what makes `build` portable to IntelliJ, where nothing is duplicated and there is
nothing to archive.

**Portability split:** `review`, `verify`, `build`, `update` are Cursor-agnostic;
`toCursor` is the lone vendor verb. The namespace gracefully absorbs a future
sibling (e.g. `toIntelliJ`) without disturbing the portable core.

## Files to modify

- `skills-anthropic/plans/code/skills/plans/SKILL.md` — **new**, the consolidated
  skill (dispatch + five verbs).
- `skills-anthropic/plans/code/.claude-plugin/plugin.json` — **new**, plugin manifest
  (mirror plan2cursor's shape).
- `skills-anthropic/plans/{chat,cowork}/SKILL.md` — **new**, surface variants
  (mirror modes/plan2cursor multi-surface layout).
- `skills-anthropic/.claude-plugin/marketplace.json` — register `plans`; decide
  plan2cursor deprecation/alias.
- [CLAUDE.md](../CLAUDE.md) — retire the `build2plan` prose; point at `/plans build`
  + `/plans toCursor`; keep the plan-workflow rules the verbs rely on.

## Implementation details

### Verb signatures

```
/plans review   [plan.md] [out.md]        → vet quality → report card
/plans verify   [plan.md] [out.md]        → audit todo-status vs reality → report card
/plans toCursor [plan.md] [archiveDir?]   → copy to ~/.cursor/plans/, open, archive original (default doc/archive/)
/plans build    [plan.md]                 → execute in place, flip todos live (no Cursor/archive)
/plans update   [plan.md] [source.md]     → apply a review/verify report back into the plan
```

### The report contract (the load-bearing design decision)

`review` and `verify` WRITE `out.md`; `update` READS it. For `update` to apply
findings **deterministically** (surgical edits, no intent re-derivation), the report
must be structured — leaning toward per-todo findings keyed by the todo's stable
`id`, each with a verdict (e.g. `status-accurate` / `overclaimed` / `stale` /
`missing-dep`) and an action line. Resolve the exact shape in `design-report-contract`
before authoring the verbs — the producers and consumer must agree.

### Cross-surface portability

Mirror the existing skills' surface-degradation patterns so the verbs don't assume
CCVC. `toCursor` keeps plan2cursor's Cowork/Claude-Code branches and denied-tools
fallbacks. `build`/`review`/`verify`/`update` are filesystem + reasoning only — no
Cursor assumption.

## Edge cases

- **Unknown/blank verb** → print the `/plans` help cheat-sheet (like `/modes`).
- **`update` handed a malformed/stale report** → refuse to apply blindly; surface
  what it couldn't map rather than churning the plan.
- **`toCursor` archiveDir missing** → create it (or default to doc/archive/), never
  silently drop the original.
- **`build` on a plan with failed `verify`** → does NOT auto-block (atoms are
  independent); but the user/agent is expected to verify first. (A future opt-in gate
  is explicitly out of scope — see below.)
- **plan2cursor users post-migration** → the standalone `/plan2cursor` must keep
  working or alias cleanly to `/plans toCursor`; document the path.

## What we are NOT doing

- **Not auto-chaining verbs.** No composite verb; the caller composes (matches the
  two-string Modes-model instinct: atoms over composites).
- **Not coupling build to review/verify.** `build` won't read a report or refuse an
  unverified plan in v1 (tempting gate, deliberately deferred — keeps atoms clean).
- **Not a sixth verb.** The vet→place→execute loop with a correction path is
  complete; resist scope creep (e.g. `/plans new`, `/plans archive`).

## Open questions

- **Report contract shape** (design-report-contract) — the structured format review/
  verify emit and update consumes. The single most important unresolved decision;
  everything in Phase 2 depends on it.
- **plan2cursor deprecation** — RESOLVED (direction): the old plan2cursor is
  **deleted**; `/plans toCursor` replaces it. Decide only the soft-landing for
  existing `/plan2cursor` users (alias vs. migration note) during marketplace-register.
- **Verb casing** — RESOLVED (cross-skill): plain verbs lowercase, proper-noun
  targets camelCase — so `toCursor` stays camelCase, `build`/`review`/`verify`/
  `update` lowercase.
- **Redistribution** — RESOLVED: combined direct install of both skills (see
  `redistribute`); no separate SBS session.
- **`verify` depth** — how hard does it try to confirm "done"? Run tests? Just check
  file/symbol existence? Static read vs. actually executing? (verb-verify — still
  open, decide during authoring.)

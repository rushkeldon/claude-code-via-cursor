---
name: Plans skill iteration — pure-markdown reports
overview: "Redesign the plans skill's report format: review/verify currently write a YAML-frontmatter report card (the report contract), which is fragile — evidence fields hold grep results and code (colons, quotes) that collapse YAML, with zero benefit since the only consumers are an LLM (update) and a human, not a machine parser. Switch both .review.md and .verify.md to PURE MARKDOWN: review = scorecard table + prose; verify = punch-list grouped by verdict (actionable-first). Keep the closed verdict vocabularies and the id/verdict/action extraction spine update relies on. Rewrite the report contract + review + verify + update verb sections accordingly, IDENTICALLY across all three surface SKILL.md files (chat, cowork, code). Also strip the skill's reference to a repo-local doc/what_makes_a_good_plan.md (that doc lives in the skills repo, not the target repo; the embedded rubric stands alone)."
todos:
  - id: predivergence-check
    content: "BEFORE editing: diff the three SKILL.md surfaces (chat, cowork, code/skills/plans) in full. They are byte-identical today; confirm still true. Branch: if identical, proceed edit-one-then-copy against the canonical file (code/skills/plans/SKILL.md). If diverged, STOP edit-one-then-copy — fall back to per-surface edits and surface why."
    status: pending
    phase: "design-contract"
  - id: contract-rewrite
    content: "In the CANONICAL file (code/skills/plans/SKILL.md): rewrite '## The report contract' (~line 86) from the YAML-frontmatter schema to a pure-markdown spec: extraction rules update relies on (bolded **todo-id** anchor, inline [verdict] tag, labeled Action: line), evidence/overall live in body prose. Keep both closed verdict vocabularies."
    status: pending
    phase: "design-contract"
  - id: review-template
    content: "In the canonical file: rewrite '## Verb: review' (~line 125) to emit a pure-markdown scorecard: rubric table (dimension | grade | notes) + per-finding prose, no frontmatter. Keep .review.md default out-path and the review verdict vocab (ready/stale/risky/hygiene-issue/lint)."
    status: pending
    phase: "verb-templates"
  - id: verify-template
    content: "In the canonical file: rewrite '## Verb: verify' (~line 154) to emit a pure-markdown PUNCH LIST grouped by verdict (Needs attention / Unverifiable / Accurate roll-up), actionable-first, evidence in body. Keep .verify.md default out-path and the verify verdict vocab (status-accurate/overclaimed/unverifiable)."
    status: pending
    phase: "verb-templates"
  - id: update-consumer
    content: "In the canonical file: rewrite '## Verb: update' (~line 251), esp. the malformed-report check (~line 261) that currently parses report_type/findings YAML keys, to read the markdown spine instead (bolded id anchor + inline [verdict] tag + Action: line); preserve the id-mismatch refusal and the auto-apply-status / propose-structural risk tiers."
    status: pending
    phase: "verb-templates"
  - id: strip-rubric-ref
    content: "In the canonical file: remove the reference to a target-repo-local doc/what_makes_a_good_plan.md in '## What a good plan is' (~line 55) and review's rubric line (~line 134). The embedded rubric is self-contained; the external doc lives only in the skills repo and is wrong to cite as repo-local."
    status: pending
    phase: "cleanup"
  - id: propagate-copy
    content: "Copy the finished canonical code/skills/plans/SKILL.md over chat/SKILL.md and cowork/SKILL.md (cp), so all edits land in all three at once. Only valid because predivergence-check confirmed the files were byte-identical; if it found divergence, this todo is cancelled in favor of per-surface edits."
    status: pending
    phase: "propagate"
  - id: surface-parity
    content: "Hard equality gate: diff chat/SKILL.md and cowork/SKILL.md against the canonical code/skills/plans/SKILL.md — both must report byte-identical (exact, no modulo). Catches a failed/partial copy."
    status: pending
    phase: "verify"
  - id: self-consistency
    content: "Grep all 3 surfaces for stale YAML-report residue: report_type, 'findings:', 'report card', frontmatter-quoting language scoped to reports. Confirm Help output (verb one-liners) and the plan-write discipline (binding on .plan.md, NOT reports) are untouched."
    status: pending
    phase: "verify"
  - id: dogfood-roundtrip
    content: "Spike: run /plans verify then /plans review against an existing plan using the NEW markdown format, then /plans update consuming each — confirm update extracts id/verdict/action from markdown and applies a status flip without a YAML parser. Branch: if extraction is ambiguous, tighten the contract's anchor rules and re-run."
    status: pending
    phase: "verify"
isProject: false
---

# Plans skill iteration — pure-markdown reports

## Problem / Context

The `plans` skill (`~/Desktop/working/skills-anthropic/plans/`) defines a **report
contract**: `review` and `verify` write a report card whose findings live in **YAML
frontmatter** (`report_type`, `findings: [{id, verdict, evidence, action}]`, `overall`),
and `update` parses that YAML to apply corrections. This was modeled on the `.plan.md`
schema — spillover from the plan format.

**Why that's wrong (the core insight):** `.plan.md` is strict YAML for one concrete
reason — a deterministic, non-LLM parser (Cursor's plans panel) consumes it; break the
YAML and the panel blanks. **Nothing mechanical parses a report.** The contract names
exactly two consumers — the `update` verb (*an LLM*) and a human (*reads prose*). Neither
needs YAML.

So the report format imports all of `.plan.md`'s fragility and none of its benefit. Worse,
it's actively hazardous: the `evidence` field is explicitly told to "cite file/symbol/grep
result; QUOTE it" — grep output and code snippets are wall-to-wall colons, quotes, braces,
i.e. exactly the content that collapses a YAML scalar and blanks the whole block (the same
bug class as the unquoted-frontmatter trap that blanks plan todos). The skill's own "QUOTE
it" instruction is an admission of the hazard. A real example: the existing
`doc/plan2cursor_to_plans_migration.review.md` has `evidence:` lines packed with escaped
`\"` and colons, one stray character from breaking.

**The fix:** make reports **pure markdown**. Determinism is kept exactly where it's free
(the closed verdict vocabularies + a bareword-safe id/verdict/action spine `update`
extracts) and YAML is dropped exactly where it's a liability (free-text evidence/narrative,
which moves to the markdown body where colons and quotes are inert).

This is a **skills-repo** change (`~/Desktop/working/skills-anthropic/plans/`), separate
from CCVC. It is intentionally sequenced AFTER the `plan2cursor → plans` CCVC migration
([plan2cursor_to_plans_migration.plan.md](plan2cursor_to_plans_migration.plan.md)).

## Approach

Two design principles, agreed in discussion:

1. **Pure markdown, no frontmatter, for both report types.** Keep the `.review.md` /
   `.verify.md` naming. The structured spine `update` needs (`id` → `verdict` → `action`)
   is closed-vocab/bareword — it carries zero quoting hazard and lives fine inline in
   markdown. All free text (`evidence`, `overall`, narrative) goes in the body.
2. **Different templates per verb, shared principles.** `review` and `verify` are different
   documents and should not share one rigid template:
   - **`review`** grades plan *quality* → a **scorecard**: rubric table (dimension | grade |
     notes) + per-finding prose. (Close to what the current review *body* already is.)
   - **`verify`** audits *status vs. reality* — a dev-QA exercise → a **punch list grouped
     by verdict**, actionable-first: `## ⚠️ Needs attention`, `## ❓ Unverifiable`, then a
     terse `## ✓ Accurate` roll-up (passing todos need no evidence, so they collapse to a
     one-line id list rather than empty table cells).

**The one structured element that survives:** the closed **verdict vocabularies** —
`review` → `ready`/`stale`/`risky`/`hygiene-issue`/`lint`; `verify` →
`status-accurate`/`overclaimed`/`unverifiable`. `update` switches on these, so they stay,
encoded as an **inline `[verdict]` tag** on each finding (belt-and-suspenders with the
section grouping: the tag is the source of truth, the grouping is presentation — robust if
findings are reordered or hand-edited).

**Critical structural fact + the edit strategy it enables:** the three surface files
(`chat/SKILL.md`, `cowork/SKILL.md`, `code/skills/plans/SKILL.md`) are **byte-for-byte
identical in full** — verified: 339 lines each, `diff` reports no difference anywhere, not
just in the report sections. Because there are **no per-surface deltas to preserve**, the
edit strategy is **edit-one-then-copy**: make all edits in a single canonical file
(`code/skills/plans/SKILL.md`), then `cp` it over the other two. This is strictly safer than
hand-applying the same multi-section edit three times (no chance of a typo in one copy).

**But the copy is only safe if they're STILL identical at execution time.** A blind `cp`
would erase a divergence introduced after this plan was written (e.g. a host-specific edit to
one surface). So `predivergence-check` re-diffs the three FIRST; only on confirmed identity
does edit-one-then-copy proceed. If they've diverged, fall back to per-surface edits
(`propagate-copy` is cancelled) and surface why.

## Conventions & assumptions

- **Target repo:** `~/Desktop/working/skills-anthropic/plans/`. The three surface files are
  `chat/SKILL.md`, `cowork/SKILL.md`, `code/skills/plans/SKILL.md`; the **canonical** edit
  target is `code/skills/plans/SKILL.md`. Assumes these three remain the full surface set; if
  a fourth surface exists at execution time, it joins the diff-gate and the copy.
- **Edit strategy is edit-one-then-copy, gated on identity.** All edits go in the canonical
  file; `propagate-copy` copies it over the others. This is valid ONLY because the files are
  byte-identical (re-confirmed by `predivergence-check`). If they've diverged, abandon the
  copy and edit each surface by hand.
- **Directory-sourced skills deploy live on save.** Editing these files may take effect
  globally and immediately (no staged/undeployed state). Consequence: do this in a focused
  pass, verify before moving on, and don't leave a surface half-edited — a broken contract
  mid-edit is a live regression.
- **What does NOT change:** the **plan-write discipline** (surgical edits, always-quote
  frontmatter scalars, preserve additive keys) is binding on `.plan.md` files and is
  **correct and unchanged** — this plan touches only the *report* format, never the plan
  format. The `toCursor` / `build` verbs, the Help output verb one-liners, and the overall
  `/plans <verb>` dispatch are untouched.
- **`update` stays LLM-driven.** We are not adding a non-LLM report parser; we're removing
  the YAML container that pretended one might exist. `update` reading markdown is strictly
  easier than escaped YAML, not harder.
- **Naming/casing unchanged:** output files remain `<planbasename>.review.md` /
  `.verify.md` in `doc/plan-reports/`.

## The steps

### design-contract

0. **`predivergence-check`** — before any edit, `diff chat/SKILL.md code/skills/plans/SKILL.md`
   and `diff cowork/SKILL.md code/skills/plans/SKILL.md`. WHY: edit-one-then-copy is only valid
   if the files are still byte-identical (they are today: 339 lines, no diff). **Branch:** both
   diffs empty → proceed; edit only the canonical `code/skills/plans/SKILL.md` for every step
   below, then `propagate-copy`. Any diff non-empty → the surfaces diverged after this plan was
   written; STOP edit-one-then-copy, cancel `propagate-copy`, and instead apply each step's edit
   to all three files by hand (preserving the divergence), noting what differed. DONE-WHEN: the
   identity verdict is established and the edit path (copy vs. per-surface) is chosen.

1. **`contract-rewrite`** — in the canonical `code/skills/plans/SKILL.md`, `## The report
   contract` (~line 86). Replace the
   YAML schema block (the ```yaml fenced `report_type`/`findings`/`overall` example) with a
   **markdown spec**. Define the extraction rules `update` depends on:
   - each finding starts with a bolded **`**todo-id**`** (the join key),
   - carries an inline **`[verdict]`** tag from the closed set,
   - and a labeled **`Action:`** line (imperative `update` applies, e.g. `set status → pending`),
   - with evidence/rationale as free prose after it.
   Keep both **verdict vocabularies** verbatim (they're load-bearing). State plainly: reports
   are pure markdown because no machine parser consumes them — only `update` (an LLM) and a
   human. WHY: this is the contract both producers write and the consumer reads; it must
   define the spine unambiguously. DONE-WHEN: the section describes a markdown shape with
   explicit id/verdict/action extraction rules and contains no YAML report schema.

### verb-templates

2. **`review-template`** — in the canonical file, `## Verb: review` (~line 125) + its `Emit a
   report card per the contract` line (~150). Specify the output as a pure-markdown **scorecard**:
   a `# Review: <plan>` heading, a **gestalt one-liner**, a rubric **table**
   (`dimension | grade | notes`), then per-finding prose each carrying the bolded id +
   `[verdict]` tag + `Action:`. Keep the `.review.md` default out-path (~131) and the review
   verdict vocab. WHY: review output is evaluative; a scorecard is its natural shape.
   DONE-WHEN: review's described output is frontmatter-free and matches the contract's spine.

3. **`verify-template`** — in the canonical file, `## Verb: verify` (~line 154) + its emit line
   (~177). Specify a pure-markdown **punch list grouped by verdict**: `# Verify: <plan>`,
   a gestalt one-liner (e.g. "3 of 8 overclaimed; 1 unverifiable"), then
   `## ⚠️ Needs attention` (overclaimed findings: bolded id + `[overclaimed]` + evidence +
   `Action:`), `## ❓ Unverifiable` (id + `[unverifiable]` + reason + recommended behavioral
   check), `## ✓ Accurate` (terse one-line id roll-up, no per-item evidence). Keep the
   `.verify.md` out-path (~161), the verify verdict vocab, and the existing read-only/tiered-
   evidence/"don't run builds" rules. WHY: verify is dev-QA — actionable findings must float
   to the top, passing ones collapse. DONE-WHEN: verify's output is frontmatter-free, grouped
   actionable-first, and the accurate roll-up doesn't force empty evidence fields.

4. **`update-consumer`** — in the canonical file, `## Verb: update` (~line 251). Rewrite step 1's
   malformed-report check (~261) — currently "parse its frontmatter … `report_type`/`findings`
   missing" — to read the **markdown spine**: locate findings by bolded **id** anchor + inline
   `[verdict]` tag + `Action:` line; a report with none of these (or unparseable structure) is
   malformed → refuse. **Preserve** the two risk tiers (auto-apply status corrections;
   propose-then-confirm structural/free-text edits) and the **id-mismatch refusal** (a finding
   whose id matches no todo → surface, don't fabricate). Note the quoting-hazard caveat now
   only bites when `update` *writes free text into the .plan.md frontmatter* (unchanged), not
   when reading the report. WHY: update is the lone consumer; its parse model must match the
   new producer format. DONE-WHEN: update reads markdown, references no `report_type`/`findings`
   YAML keys, and keeps both risk tiers + the id-mismatch guard.

### cleanup

5. **`strip-rubric-ref`** — in the canonical file, `## What a good plan is` (~line 55) and
   review's rubric line (~line 134). Remove the citation of a **target-repo-local**
   `doc/what_makes_a_good_plan.md` — that doc exists in the *skills* repo, not the repo a user
   runs `/plans` against, so citing it as repo-local is wrong and dangling. The embedded rubric
   (done-when checks, out-of-scope fences, conventions explicit, stable anchors, no unresolved
   decisions) is self-contained; keep it, drop only the external pointer. WHY: an agent (the
   one that wrote this review) already tripped on the missing doc. DONE-WHEN: no SKILL.md cites
   a repo-local `what_makes_a_good_plan.md`; the inline rubric still stands alone.

### propagate

6. **`propagate-copy`** — once all canonical-file edits (1–5) are done, copy it over the other
   two: `cp code/skills/plans/SKILL.md chat/SKILL.md` and
   `cp code/skills/plans/SKILL.md cowork/SKILL.md`. WHY: lands every edit in all surfaces in one
   atomic step, with zero chance of a hand-transcription typo. **Branch:** if `predivergence-check`
   found divergence, this todo is **cancelled** — the per-surface hand-edits already covered all
   three. DONE-WHEN: both copies completed (or this todo cancelled because the per-surface path
   was taken).

### verify

7. **`surface-parity`** — hard equality gate: `diff chat/SKILL.md code/skills/plans/SKILL.md` and
   `diff cowork/SKILL.md code/skills/plans/SKILL.md`; **both must be empty** (byte-identical, no
   modulo). WHY: catches a failed or partial `cp` — if the copy half-wrote, one surface ships a
   stale contract. DONE-WHEN: both diffs report no difference.

8. **`self-consistency`** — grep all 3 surfaces for stale YAML-report residue
   (`report_type`, `findings:`, "report card" where it implied YAML). Confirm the **Help
   output** verb one-liners (~286) and the **plan-write discipline** (binding on `.plan.md`)
   are untouched. WHY: catch half-migrated language that contradicts the new format.
   DONE-WHEN: no report-YAML residue; plan-format rules and Help output intact.

9. **`dogfood-roundtrip`** (spike) — run `/plans verify` then `/plans review` on an existing
   plan with the NEW format, then `/plans update` consuming each. Confirm `update` extracts
   id/verdict/action from markdown and applies a status flip with no YAML parser involved.
   **Branch:** if extraction is ambiguous or `update` misreads a finding, tighten the
   contract's anchor rules (e.g. make the `[verdict]` tag mandatory and first-on-line) and
   re-run until a clean round-trip. WHY: the contract is only proven by an actual
   producer→consumer round-trip, not by reading the prose. DONE-WHEN: a verify/review report
   round-trips through `update` and applies at least one correction cleanly.

## Out of scope

- **Do NOT touch the `.plan.md` format or the plan-write discipline** — this is reports only.
  The frontmatter-quoting rules for plans stay exactly as they are.
- **Do NOT change `toCursor` or `build`** — they don't touch reports.
- **Do NOT add a non-LLM report parser** or any tooling that consumes reports mechanically —
  the entire point is that none exists; don't reintroduce the assumption.
- **Do NOT change the `/plans <verb>` dispatch, the Help output, or verb names/casing.**
- **Do NOT create `what_makes_a_good_plan.md` in any target repo** — strip the reference, don't
  satisfy it (the real doc lives in the skills repo).
- **Do NOT edit `doc/plan-reports/*` historical reports** in any repo — old YAML reports are
  snapshots; the new format applies going forward.
- **This is the skills repo, not CCVC** — no CCVC code, package.json, or VSIX work here. No
  BBPI (that's the migration plan's concern).

## Verification

- All three SKILL.md surfaces describe pure-markdown `.review.md` (scorecard) and `.verify.md`
  (verdict-grouped punch list), with the id/verdict/action spine and closed verdict vocabs
  intact; `update` reads that spine.
- `grep -rn "report_type\|findings:" ~/Desktop/working/skills-anthropic/plans/` → zero hits in
  report context.
- No surface cites a repo-local `what_makes_a_good_plan.md`.
- Help output + `.plan.md` plan-write discipline unchanged across all three surfaces.
- **Round-trip proven:** a freshly-generated markdown verify (or review) report is consumed by
  `/plans update`, which extracts findings and applies a correction — no YAML parser in the
  loop.
- **Escape hatch:** if reality diverges from this plan (e.g. the three surfaces are NOT
  byte-identical in these sections, or a fourth surface exists, or `update`'s parse can't be
  made unambiguous from markdown alone) — STOP and surface it; do not improvise a format that
  only half the surfaces share.

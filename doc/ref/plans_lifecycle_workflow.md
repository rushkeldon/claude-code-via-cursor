# The `plans` skill lifecycle workflow

A description of the workflow _implied_ by the `plans` skill (`/plans <verb>`). The skill
is built from five independent verbs that **never call each other** — but the way each
verb is shaped (what it _produces_ vs. what it _consumes_) implies one canonical
lifecycle for a `*.plan.md` file, from a blank idea through authoring, execution, and QA.

This document presents everything **in workflow order**. It also pulls in the two
**authoring modes** (`collaborate`, `write`) that precede the `plans` verbs — they're not
part of the skill, but they're the first two steps a user actually takes, and the plan
picker shows them in the same menu.

## The workflow at a glance

The plan picker lists its options _nearly_ in workflow order. Here they are in **true**
workflow order, with the two leading authoring modes folded in:

```
collaborate ─▶ write ─▶ [review] ─▶ [toCursor] ─▶ build ─▶ [verify]
  (clarify)   (author)   (vet)        (place)      (run)   (reconcile)
                            └────────────┐                      │
                                    [update] ◀───── report ─────┘
                            (update a plan based on a report - either before building or for another build)
```

`[brackets]` = **optional** step. Only **author the plan** and **build it** are load-bearing
— everything else strengthens the result but can be skipped. `update` is not a stage in
the line; it's a **satellite** that fires _off_ a `review` or `verify` report (steps 1 and
4 below) and usually hands back to `build`.

## The verbs & activities, in workflow order

| #   | Skill Verb            | Activity                                                                   |
| --- | --------------------- | -------------------------------------------------------------------------- |
| 0   | `collaborate`_(none)_ | Discuss, explore, get the problem clear                                    |
| 0   | `write`_(none)_       | Author the plan as rails for the implementer                               |
| 1   | `review`              | Have the**target implementor model** vet the plan's quality → report `.md` |
| 1a  | `update`              | Apply the review report's findings back into the plan                      |
| 2   | `toCursor`            | Copy the plan into`~/.cursor/plans/`, **archive the original**             |
| 3   | `build`               | Execute the plan (sub-agent or in-session); keep todos live                |
| 4   | `verify`              | Assess plan state**vs. code state** → report `.md`                         |
| 4a  | `update`              | Apply the verify report's findings back into the plan                      |

\* "Required" in the loose sense: you must author _something_ and build _something_ to make
progress. Both can take other forms (a plan written by hand, a build run by Cursor's own
agent), but no plan reaches done without these two.

`review`/`verify` are **producers** (emit a report). `update` is the lone **consumer**
(eats a report). `toCursor` **places**. `build` **executes**. The skill is explicit: **no
verb auto-runs another — the caller composes them.**

## Stage-by-stage

### Stage 0 — Collaborate, then write _(authoring modes, not part of `plans`)_

Before any `plans` verb runs, a plan has to exist. Two modes precede the skill:

- **`collaborate`** — discuss, explore, and get the problem _clear_ before committing
  anything to a plan file. No artifact; this is the thinking-out-loud phase.
- **`write`** — author the `*.plan.md` itself — ideally with a high-reasoning model — as a
  set of **rails** for a possibly cheaper, lower-reasoning implementer who should only
  _execute and verify_, never re-derive intent or choose between options. The high-value
  rails: **done-when checks** (behavioral, not "it compiles"), **out-of-scope fences**,
  **conventions made explicit**, **stable anchors** (symbols/unique strings, never line
  numbers), and **no unresolved decisions**.

The `plans` skill disclaims authoring (that's the modes' job), so the lifecycle the skill
governs _starts_ where `write` hands off a finished plan file.

### Stage 1 — Review _(optional)_

Have the **target implementor model** — the same (often cheaper) model that will run the
plan — review it, so the vet reflects what _that_ model can actually execute. Grade the
plan's **quality as written**: is it executable without guessing? Read-only on the plan;
writes only a report card. Rubric dimensions: execution-readiness (no open questions),
stale assumptions (grep to confirm refs still exist), cross-surface/regression risk, rails
present, TODO hygiene, mechanical lint (frontmatter parses, scalars quoted, statuses
valid).

Verdict vocabulary: `ready · stale · risky · hygiene-issue · lint`.

> **`update` may be called here.** If the review surfaces fixable problems, run
> `/plans update <plan> <review-report>` to apply them, then (optionally) review again.
> See **The `update` satellite** below.

### Stage 2 — toCursor _(optional)_

Copy the corrected plan into `~/.cursor/plans/`, open it in Cursor, and **archive the repo
original** (default `doc/archive/`). This is the moment the **source of truth migrates**:
the instant the copy lands, _that copy is the canonical, live plan_. Archiving the original
removes the "decoy" second editable copy — collapsing to one live file + one inert
snapshot. It's the **lone vendor-coupled verb** (a future `toIntelliJ` would slot in beside
it). After this, edit the Cursor copy, never the archive.

Optional because `build` runs a plan **in place** at any path — you can skip `toCursor`
entirely and build the repo file directly. `toCursor` is for when you want Cursor's plans
panel to render the live todos.

### Stage 3 — Build _(required\*)_

Execute the plan **at its given path, in place** — no copy, no Cursor, no archive (that
purity is what keeps it portable: the path may be a Cursor copy, a plain repo file, or a
future IntelliJ plan). Two equally valid execution modes:

- **Spawn a sub-agent** to execute the plan, or
- **Execute in the current session.**

**Either way, both keep the plan's todos up to date** as work lands. The per-todo loop:

1. Flip `pending` → `in_progress` _before_ the first tool call against the todo (early flip
   is what makes a live panel show in-flight state; never batch flips).
2. Do the work the todo describes — follow its stable anchor, respect conventions and the
   out-of-scope fence.
3. Check **done-when** ("compiles" ≠ "works"); only then flip `in_progress` →
   `completed`, immediately.
4. **If you bail** (blocker, decision needed, out of scope), flip → `cancelled` with a
   one-line note in the body explaining why.

**The escape hatch:** if code/reality **does not match the plan**, STOP and surface it —
do not improvise. A diverged reality is the derail case; report it as a cheap question.

### Stage 4 — Verify _(optional)_

Reconcile the **state of the plan against the state of the code** — does each todo's
recorded `status` tell the truth? A todo marked `completed` should _actually_ be completed;
one marked `in_progress` should really be in flight; a todo that claims `in_progress` but is
in fact done is just as much a discrepancy as the reverse. `verify` finds those diffs and
reports them (and, via `update`, can correct the plan to match).

This is QA **of the plan, not of the product** — it isn't testing whether the feature is
good, it's confirming the plan's bookkeeping is honest about what the code already shows.
Because it grades whether `completed` todos are _actually_ done, `verify` is inherently a
**post-build** pass. Tiered, evidence-graded, read-only by default; writes only a report
card:

1. Existence/static checks (always) — does the claimed file/symbol/section exist?
2. Test coverage (note, **don't run** — keeps `verify` fast, safe, portable).
3. Grade each todo `status-accurate | overclaimed | unverifiable`.

> **`update` may be called here.** Feed the verify report to `/plans update` to flip
> `overclaimed` todos back to `pending`, then **re-`build`** them and verify again — the
> `verify → update → build` loop, repeated until verify comes back clean.

## The `update` satellite

`update` is the only verb that **writes the plan from a report**, and the only one that
doesn't sit at a fixed point in the line — it fires _off_ a report produced at **Stage 1**
(`review`) or **Stage 4** (`verify`), and typically hands back to `build`:

```
review ──▶ report ──▶ update ──▶ (re-build / re-review)
verify ──▶ report ──▶ update ──▶ re-build ──▶ verify ──▶ … until clean
```

It's the **riskiest** verb — it writes into fragile YAML frontmatter — so it's tiered:

- **Auto-apply: `status` corrections** — surgical `status:`-line flips (barewords, no
  quoting hazard).
- **Propose-then-confirm: structural edits** — content rewrites, adding/removing todos,
  rewording `overview` (anything writing free text into frontmatter). Show the exact
  change, get confirmation, always-quote the scalar.

`update` refuses to act on a malformed/stale report or a finding whose `id` matches no todo
— it surfaces what couldn't be mapped rather than churning the plan blindly.

## The four TODO statuses

`pending → in_progress → completed` is the happy path. There are **four status keywords**;
`build` has two exits per todo — the success exit (`completed`) and the bail exit
(`cancelled`):

| Status        | Meaning                                                                | Set by           |
| ------------- | ---------------------------------------------------------------------- | ---------------- |
| `pending`     | Not started (or reset by`update` after an `overclaimed` verdict)       | author /`update` |
| `in_progress` | In flight — flipped*before* the first tool call                        | `build` step 1   |
| `completed`   | Done**and done-when verified**                                         | `build` step 3   |
| `cancelled`   | **Bailed** — blocker / decision / out of scope, with a recorded reason | `build` step 4   |

`cancelled` is a first-class terminal state, not a throwaway: it's the durable trace that
says "this rail was deliberately abandoned, here's why," so a later `verify` or human
doesn't mistake it for a forgotten `pending`.

Keyword hazard: it's `in_progress` **with an underscore** — `in-progress` (hyphen) parses
but the spinner silently never renders.

## What connects atoms that never call each other

The verbs are decoupled; the only thing wiring producers to the consumer is a shared
**report contract** — a file format, not a function call:

- **Reports are YAML-frontmatter `.md`** — machine-readable findings in frontmatter, human
  narrative in the body. Their audiences are `update` (an LLM) and a human.
- Every finding carries an **extraction spine** `update` reads: an **`id`** (the JOIN KEY
  into the plan's todos), a **`verdict`** from a closed set, and an **`action:`** line (the
  imperative `update` applies).
- The `id` is the contract: a finding whose `id` matches no todo is a report error to
  surface, never a todo to invent.

## Design philosophy: Unix pipes for plan lifecycle

The workflow is **implied, not enforced**. Small, single-purpose, file-mediated verbs,
composed by the operator rather than wired together internally:

- `build` will **not** gate on `verify` or refuse an unverified plan.
- `update` will **not** auto-run `review`/`verify`; you hand it a report.
- There is **no composite verb** — the old `build2plan` is _just_ `toCursor` then `build`,
  run by the caller.
- There is **no sixth verb** — vet → place → execute, with a correction path, is complete
  by design.

---

## Suggestions: making the workflow more obvious from the skill itself

The skill is correct and composable, but a first-time reader can't _see_ the lifecycle —
the verbs read as a flat, unordered set. Concrete changes that would surface the implied
order without breaking the "independent atoms" design:

1. **Order the Invocation table in workflow order, not by casing/grouping.** Today it lists
   `review · verify · toCursor · build · update`. Reordering to **`review → toCursor → build → verify → update`** (with `update` last, flagged as "applies a report from
   `review`/`verify`") would make the table itself read as the timeline. This is the single
   highest-leverage change.
2. **Reorder the plan-picker menu to match.** The picker currently shows
   `collaborate · write · review · verify · update · build · toCursor` — `verify`/`update`
   appear _before_ `build`/`toCursor`, which is backwards. Reordering to
   `collaborate · write · review · toCursor · build · verify · update` makes the menu a
   left-to-right workflow, and the menu is most users' first contact with the verbs.
3. **Mark optionality in the verb list.** A one-glyph cue (e.g. a `*` or "(optional)") on
   `review`, `verify`, `toCursor`, `update` — leaving `write`+`build` unmarked — tells a
   reader at a glance which steps are the spine and which are reinforcement. The current
   prose says "compose them," but never says _which two you can't skip_.
4. **Split the top diagram into a timeline, not a producer/consumer cluster.** The skill's
   ASCII diagram groups `review`/`verify` together as co-producers, which makes them look
   like one stage. They fire at **opposite ends** (`review` pre-build, `verify` post-build).
   A single horizontal timeline — `review → toCursor → build → verify`, with `update`
   hanging below as the report-feedback arrow — would teach the shape in one look.
5. **Name `verify` as the post-build verb explicitly.** Nothing in the verb's one-liner says
   it's only meaningful _after_ `build` (its `overclaimed` verdict can't exist until a todo
   is marked `completed`). Adding "post-build" to its description ("audit each todo's status
   vs. reality **after building**") removes the most common ordering confusion.
6. **Document the `verify → update → build` loop as a named pattern.** The skill mentions
   each verb but never names the QA cycle they form. A short "Post-build QA loop" callout —
   "run `verify`; feed its report to `update`; re-`build` the reset todos; repeat until
   `verify` is clean" — turns three atoms into one recognizable, repeatable move.
7. **Clarify that `review` should run as the implementor model.** The workflow intent is
   that the _target implementor_ vets the plan (so the vet reflects what that model can
   execute). The skill describes the rubric but not _who_ should run it; one sentence would
   close that gap.
8. **Give `update` a "called from" note instead of listing it as a peer step.** Because
   `update` only ever fires off a `review` or `verify` report, presenting it as the 3rd of
   5 equal verbs hides its satellite nature. A "typically invoked right after `review`
   (Stage 1) or `verify` (Stage 4)" note would place it correctly without adding coupling.

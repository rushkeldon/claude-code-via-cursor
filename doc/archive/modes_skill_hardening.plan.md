---
name: Harden the modes skill against read-free state assumptions
overview: "Fix the failure where a /modes directive is answered from conversation memory instead of the active_modes.md source of truth — producing a wrong echo AND leaving the file unwritten (observed: /modes plan ./doc emitted 'already active' while the file said agent). Root cause: the skill's read+write steps are SOFT guards a confident model shortcuts, and the read-free no-op branches ('already active' / 'not active' / list) are the exact escape an assuming model takes. Fix in the skill (../skills-anthropic/modes, all 3 surfaces): make the read MANDATORY and load-bearing for the echo, and make EVERY state directive WRITE the resolved state unconditionally (kill the no-op branches) so the file self-heals regardless of what the model assumed. Edit-one-then-copy (the 3 surfaces are byte-identical)."
todos:
  - id: predivergence-check
    content: "BEFORE editing: diff the three modes SKILL.md surfaces (chat, cowork, code/skills/modes) in full. They are byte-identical today (386 lines each); confirm still true. Branch: identical → edit canonical code/skills/modes/SKILL.md then copy; diverged → per-surface edits, surface why, cancel propagate-copy."
    status: pending
    phase: "guard"
  - id: mandatory-read
    content: "In the canonical SKILL.md 'Handling a directive' step 1 (~line 214): strengthen from 'read the file' to a HARD rule — you do NOT know current modes from conversation history (it WILL be stale across builds/agent-switches/other turns); you MUST Read <session_id>/active_modes.md every directive and base everything on what you READ, never on memory. Add a one-line rationale tying it to the pill's 'reflect the file, never an optimistic click' design."
    status: pending
    phase: "harden"
  - id: mandatory-write
    content: "In the canonical SKILL.md step 3 + dispatch (lines ~216-224): make EVERY state-mutating directive WRITE the full resolved state unconditionally — including re-entering an already-active mode. Remove the read-free no-op shortcut so the file (and thus the pill) self-heals even if the model's echo is wrong. 'already active'/'not active' remain ECHO variants, but they no longer skip the write."
    status: pending
    phase: "harden"
  - id: echo-from-read
    content: "In the canonical SKILL.md Echo contract / step 5: require the echo to be DERIVED from the state just read (e.g. the displaced-mode line must reflect what the file actually held), so a correct echo is impossible without having read. Forbid reconstructing the echo from conversation history."
    status: pending
    phase: "harden"
  - id: list-still-readonly
    content: "Preserve the genuinely read-only paths: /modes list and the cheat-sheet stay no-WRITE — but list MUST still READ first (it echoes active modes, so it needs the real file). Confirm the mandatory-write change does NOT force a spurious write on list/cheat-sheet."
    status: pending
    phase: "harden"
  - id: propagate-copy
    content: "Copy the finished canonical code/skills/modes/SKILL.md over chat/SKILL.md and cowork/SKILL.md. Valid only because predivergence-check confirmed byte-identical; cancelled if diverged."
    status: pending
    phase: "propagate"
  - id: surface-parity
    content: "Hard equality gate: diff chat/SKILL.md and cowork/SKILL.md against canonical code/skills/modes/SKILL.md — both byte-identical (no modulo). Catches a partial copy."
    status: pending
    phase: "verify"
  - id: dogfood
    content: "Spike: in a session where the file says one mode, issue a /modes directive for a DIFFERENT mode and confirm (a) the file is WRITTEN to the new state, (b) the echo names the correct displaced prior mode — proving the read+write actually happened, not memory. Branch: if the model still shortcuts, escalate the wording (e.g. lead step 1 with the imperative) and re-run."
    status: pending
    phase: "verify"
isProject: false
---

# Harden the modes skill against read-free state assumptions

## Problem / Context

A `/modes` directive can be answered from **conversation memory** instead of the
`active_modes.md` **source of truth** — producing a wrong echo *and* (worse) leaving the
file unwritten. Observed this session: with the file holding `- agent`, `/modes plan ./doc`
emitted *"mode plan is already active"* (reconstructed from history that said we'd been
planning) — contradicting the file, and writing nothing, so the state stayed `agent`.

**Why slash commands are MORE vulnerable than natural language** (the non-obvious part):

- **Natural language** ("use the modes skill to enter plan mode") forces a **Skill-tool
  invocation** — the skill body returns as a result the model then acts on, and the Read/Write
  tool calls follow visibly.
- **Slash command** (`/modes plan ./doc`) **injects the SKILL.md text directly into context**
  as the command expansion — there is **no forced tool call**. The instructions are just
  *present*, so a confident model can read them and emit an echo **without ever touching the
  file.** The path that feels most direct has the *least* enforcement.

**Root cause:** the skill's "read the file" (step 1) and "write the state" (step 3) are **soft
guards** — instructions a confident model overrides. And the **read-free no-op branches**
(`already active`, `not active`, `list`) are the exact escape: they let the model emit an echo
with no Read and no Write. The damage in the observed failure was *entirely* the missing
write (file stayed wrong) compounded by the missing read (echo was wrong).

This is the same "verify against the source of truth, never trust a stale record" lesson that
recurs across this project — applied to the very skill whose stated design is *"the pill
reflects the file, never an optimistic click."*

## Approach

Fix in the **skill** (`~/Desktop/working/skills-anthropic/modes/`), not CCVC — the host side
([modes.ts](src/modes.ts)) already correctly mirrors whatever the file says; the bug is the
skill letting the file go unwritten / the echo go unread. Two complementary hardening moves,
because either alone is insufficient:

1. **Make the file self-heal — WRITE unconditionally (the safety net).** Every state-mutating
   directive writes the full resolved state, *including re-entry of an already-active mode*.
   Killing the read-free no-op means even a model that assumes wrongly still leaves the file
   correct, and the pill (which watches the file, per [modes.ts](src/modes.ts)) self-corrects
   regardless of the prose echo. This *directly* fixes the observed damage (unwritten file).
2. **Make the echo honest — READ is mandatory and load-bearing.** Strengthen step 1 from "read
   the file" to "you do NOT know the modes from history; Read every time; derive the echo from
   what you read." Require the echo (e.g. the displaced-mode line) to reflect the *file's* prior
   state, so a correct echo is impossible without a real Read.

Together: #1 guarantees correct *state* no matter what; #2 guarantees an honest *echo*. Neither
relies on "please try harder" alone — they make the right behavior require a tool call.

The 3 surface files (`chat/`, `cowork/`, `code/skills/modes/SKILL.md`) are **byte-identical**
(386 lines each, verified) → **edit-one-then-copy** against the canonical
`code/skills/modes/SKILL.md`, gated on a re-confirmed identity check (same protocol as the
plans-skill iteration).

## Conventions & assumptions

- **Target repo:** `~/Desktop/working/skills-anthropic/modes/`; canonical edit target is
  `code/skills/modes/SKILL.md`; propagate to `chat/` and `cowork/`.
- **Directory-sourced skills deploy live on save** — these edits take effect globally
  immediately. Do it in a focused pass; don't leave a surface half-edited.
- **Host side is correct and OUT of scope.** [modes.ts](src/modes.ts) already follows the
  file path-agnostically and the pill reflects the file. We are NOT changing detection — only
  the skill's read/write discipline so the file it watches is actually kept correct.
- **`/modes list` and the cheat-sheet stay read-only on WRITE** — but `list` still must READ
  (it reports active modes from the real file). The cheat-sheet reads/writes nothing (it's
  static help). Don't let "write unconditionally" leak onto these.
- **No new behavior, no new directives** — this hardens the existing flow's *enforcement*, not
  its feature set. Echo formats stay as specified; "already active"/"not active" remain as
  echo *wording*, just no longer write-skipping.
- Assumes the 3 surfaces remain identical at execution time; if a 4th surface exists, it joins
  the diff-gate and copy.

## The steps

### guard

0. **`predivergence-check`** — `diff chat/SKILL.md code/skills/modes/SKILL.md` and
   `diff cowork/SKILL.md code/skills/modes/SKILL.md`. **Branch:** both empty → edit canonical +
   propagate; any diff → STOP edit-one-then-copy, cancel `propagate-copy`, edit each surface by
   hand. DONE-WHEN: identity verdict established, edit path chosen.

### harden

1. **`mandatory-read`** — canonical SKILL.md "Handling a directive" step 1 (anchor: *"Resolve
   the session id ... read `<auto-memory>/<session_id>/active_modes.md`"*, ~line 214). Rewrite to
   a HARD imperative: **"You do NOT know the current modes from conversation history — it WILL
   be stale (modes change across builds, agent switches, and prior turns). Read
   `<session_id>/active_modes.md` on EVERY directive and base the dispatch + echo on what you
   READ, never on memory."** Tie it to the design: the pill reflects the file, never an
   optimistic click — answering from memory reintroduces exactly the desync the skill exists to
   prevent. WHY: the read was soft and got skipped. DONE-WHEN: step 1 forbids memory-sourced
   state in plain terms and names the staleness.

2. **`mandatory-write`** — canonical SKILL.md step 3 (~line 224) + the dispatch bullets
   (~216-223). Make **every state-mutating directive WRITE the full resolved state
   unconditionally**, including re-entering an already-active mode (today: *"If the mode is
   already in the set, emit the 'already active' echo"* — which skips the write). Reframe:
   "always write the resolved state; the 'already active' / 'not active' cases differ only in
   ECHO wording, never in whether the write happens." WHY: the unwritten file was the actual
   damage; an unconditional write self-heals it regardless of a wrong assumption. DONE-WHEN: no
   state directive can complete without a Write; re-entry writes too.

3. **`echo-from-read`** — canonical SKILL.md Echo contract + step 5. Require the echo to be
   **derived from the state just read** — specifically the displaced-mode line (e.g. "mode
   agent is now inactive") must reflect what the **file** held, not what the model recalls. State
   plainly: do not reconstruct the echo from conversation history. WHY: makes the read
   load-bearing — a correct echo becomes impossible without having read. DONE-WHEN: the contract
   ties the echo's prior-state claims to the file read.

4. **`list-still-readonly`** — canonical SKILL.md: confirm/curate that `/modes list` and the
   cheat-sheet do **not** write (list echoes; cheat-sheet is static), while ensuring `list`
   still **reads** first. Make the asymmetry explicit so `mandatory-write` isn't misread as
   "write on list too." WHY: preserve the genuinely read-only paths; avoid a spurious write
   regression. DONE-WHEN: list reads-but-doesn't-write; cheat-sheet neither; the rest always
   write.

### propagate

5. **`propagate-copy`** — `cp code/skills/modes/SKILL.md chat/SKILL.md` and `… cowork/SKILL.md`.
   **Branch:** cancelled if `predivergence-check` found divergence (per-surface edits instead).
   DONE-WHEN: both copies done (or cancelled for the per-surface path).

### verify

6. **`surface-parity`** — `diff chat/SKILL.md code/skills/modes/SKILL.md` and
   `diff cowork/SKILL.md code/skills/modes/SKILL.md`; both empty. WHY: catch a partial copy.
   DONE-WHEN: both diffs report no difference.

7. **`dogfood`** (spike) — set up the exact failure: ensure `active_modes.md` holds one mode
   (say `agent`), then issue `/modes plan ./doc`. Confirm BOTH: (a) the file is **written** to
   `- plan: ./doc`, and (b) the echo names the correct displaced prior mode (**"mode agent is
   now inactive"**) — proving a real read+write, not memory. **Branch:** if the model still
   shortcuts (no write, or wrong displaced mode), escalate the wording — lead step 1 with the
   imperative, or add an explicit "if you did not just Read the file, you cannot answer" gate —
   and re-run until a clean pass. WHY: the fix is only proven by reproducing the original bug
   and seeing it not recur. DONE-WHEN: the reproduce-the-failure case writes the file and emits
   the correct displaced-mode echo.

## Out of scope

- **No changes to CCVC** — [modes.ts](src/modes.ts), the pill, detection. The host is correct;
  this is skill-only.
- **No new directives, modes, or echo formats** — harden enforcement of the existing flow only.
- **Don't make `list` or the cheat-sheet write** — they stay read-only-on-write (list still
  reads).
- **Don't touch the `plans` skill** or any other skill — modes only.
- **Don't edit `doc/archive/*`.**
- This is the skills repo, not CCVC — **no package.json bump, no VSIX, no BBPI.**

## Verification

- All 3 modes SKILL.md surfaces: step 1 mandates a Read every directive and forbids
  memory-sourced state; every state directive writes unconditionally (re-entry included); the
  echo is derived from the read; `list`/cheat-sheet stay write-free (list still reads).
- `grep` the surfaces: no surviving "if already in the set, emit … echo" phrasing that *skips*
  the write.
- All 3 surfaces byte-identical after propagate (surface-parity).
- **Reproduce-the-bug dogfood passes:** file=agent → `/modes plan ./doc` → file becomes
  `plan: ./doc` AND echo says "mode agent is now inactive". (This is the exact case that failed
  today.)
- **Escape hatch:** if reality diverges — the 3 surfaces aren't byte-identical, or the model
  still shortcuts the read/write even after escalated wording — STOP and surface; don't ship a
  half-applied hardening that only some surfaces have.

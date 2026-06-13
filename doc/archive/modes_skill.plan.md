---
name: "modes skill — fix invocation docs to /modes <verb> reality + finish session-scoped + cleanup"
overview: "Three things, one skill (../skills-anthropic/modes — GLOBAL, marketplace-distributed). (1) CORRECTNESS: the SKILL.md documents a /enterMode, /exitMode, /listModes, /clearModes command interface that does NOT exist as typed — the real, working entry point is the single dispatched command /modes <verb> [param1] [param2] (e.g. /modes plan ./doc, /modes agent, /modes sbs, /modes clear). Rewrite the skill's vocabulary so docs match reality, aligning with the sibling /plans <verb> dispatch idiom. (2) FINISH session-scoped modes: the additive per-session-dir layer, pointer-retention regression guard, and migration are already edited into SKILL.md source from session_scoped_modes.plan.md — finalize + redistribute them. (3) CLEANUP: general tidy of the SKILL.md (structure, dedupe) with NO further behavior change. Execute in a FRESH session rooted in the skills repo, not in a CCVC session. Redistribution (DECIDED, changed from SBS): once both skills are built and old plan2cursor deleted, install modes + /plans directly across all targets/surfaces in one combined pass."
todos:
  - id: invocation-audit
    phase: "Phase 1 — Invocation truth"
    content: "Audit every place the SKILL.md names the interface: the directive table (/enterMode, /exitMode, /listModes, /clearModes), the echo contract, the natural-language mappings, the help cheat-sheet, and the handling steps. Catalog each occurrence — this is the surface that must be rewritten to /modes <verb> form. VERIFY the real form first: confirm against actual usage that /modes <verb> [param] is what fires (this CCVC session's history is evidence: every mode change went through the modes skill invocation with args like 'plan ./doc', never /enterMode)."
    status: pending
  - id: invocation-rewrite
    phase: "Phase 1 — Invocation truth"
    content: "Rewrite the skill's vocabulary to the single-dispatch form /modes <verb> [param1] [param2]. VERB GRANULARITY DECIDED (mode-as-verb, matches what works today): the MODE NAME is the verb to enter — /modes plan ./doc, /modes agent, /modes sbs. The reserved verbs are: <mode-name> (enter that mode), exit (e.g. /modes exit sbs), clear (clear all), list (show active). Exiting plan/agent is normally via the plan<->agent mutex (entering one exits the other) or /modes clear; /modes exit <mode> turns off a specific compose-mode like sbs/exclude/include. Update the directive table, echo contract examples, natural-language mappings, help cheat-sheet, and numbered handling steps to all speak /modes <verb>. Remove the /enterMode//exitMode//listModes//clearModes command spellings; keep them ONLY as recognized natural-language aliases (soft aliases; /modes <verb> is canonical)."
    status: pending
  - id: invocation-consistency
    phase: "Phase 1 — Invocation truth"
    content: "Align with the sibling /plans skill's dispatch idiom (plans_skill.plan.md): same 'one command, dispatch on first arg, unknown/blank verb prints help' shape. CASING RULE DECIDED (applies to BOTH skills): plain verbs lowercase (/modes plan, /modes exit, /plans build, /plans review); verbs naming a proper-noun target are camelCase (/plans toCursor). /modes verbs are all plain-lowercase. Confirm the modes rewrite obeys this."
    status: pending
  - id: session-scoped-fix-live-regression
    phase: "Phase 2 — Finish session-scoped"
    content: "*** ACTIVE GLOBAL REGRESSION — FIX FIRST. *** The session-scoped edit is NOT 'undeployed source' — the skills-anthropic marketplace is a DIRECTORY source, so editing SKILL.md went LIVE in every Claude Code session immediately. Current broken state: the skill WRITES to <sid>/active_modes.md whenever a session id resolves (always true in Claude Code), but only CCVC has the loader hook to READ it; everywhere else the MEMORY.md pointer still reads the FLAT file → entering a mode silently does not persist on every hook-less project. The write path and read path diverge. FIX: make per-session mode self-sufficient WITHOUT a hook — e.g. the skill keeps the flat file in sync (write-through) so the pointer always reflects the active mode, OR the skill maintains a per-session pointer; the hook then becomes a pure optimization, not a correctness requirement. Decide the mechanism, then ensure NO surface regresses: hook-less = still persists via flat/pointer; CCVC-with-hook = per-session isolation. Reconcile with the /modes <verb> rewrite (overlapping sections)."
    status: pending
  - id: cleanup-tidy
    phase: "Phase 3 — Cleanup"
    content: "General SKILL.md tidy, NO behavior change: dedupe repeated explanations, tighten structure, ensure the State-file / handling-steps / echo-contract sections are internally consistent after the invocation rewrite + session-scoped edits. Keep the multi-surface degradation branches (Chat/Cowork/Desktop) intact."
    status: pending
  - id: surface-variants
    phase: "Phase 3 — Cleanup"
    content: "Propagate the invocation + session-scoped changes to the other surface variants (modes/chat/SKILL.md, modes/cowork/SKILL.md) so all surfaces document /modes <verb> consistently. Each surface keeps its own degradation behavior, but the invocation vocabulary must match."
    status: pending
  - id: redistribute
    phase: "Phase 4 — Redistribute"
    content: "DECISION CHANGED (was SBS/proper-channels-only; now: install directly everywhere once built). After BOTH skills are built and the old plan2cursor is deleted, install the edited GLOBAL modes skill across ALL targets/surfaces it ships to — Claude Code (marketplace cache ~/.claude/plugins/cache/skills-anthropic/modes/<ver>/; bump plugin.json version if the cache keys on it) AND Claude Desktop (its install path). Do the same for /plans in the same pass. Verify post-install with a NAIVE session (no design context — pollution-free) that (a) /modes <verb> works, (b) per-session files are written, (c) hook-less surfaces still load via the retained pointer. NOTE: this is now a combined install step covering modes + /plans together (not per-skill)."
    status: pending
isProject: false
---

# modes skill — fix invocation docs + finish session-scoped + cleanup

## Background

Three threads converged on the same global skill (`../skills-anthropic/modes`), so
they're planned together:

1. **Invocation docs are wrong (a correctness bug).** The SKILL.md documents a
   command interface — `/enterMode plan`, `/exitMode agent`, `/listModes`,
   `/clearModes` — that **does not exist as typed**. The real, working entry point
   is a single dispatched command: **`/modes <verb> [param1] [param2]`**
   (`/modes plan ./doc`, `/modes agent`, `/modes sbs`, `/modes clear`). Evidence is
   abundant in the CCVC session that spawned this plan: every mode change went
   through the modes skill invocation with args like `plan ./doc` / `agent` /
   `clear all` — `/enterMode` never fired as a command. The docs describe a
   pre-implementation design that the wiring diverged from. **Decision (locked with
   user): `/modes <verb>` is the truth; rewrite the docs to match it.**

2. **Session-scoped modes is half-landed.** Per
   [session_scoped_modes.plan.md](archive/session_scoped_modes.plan.md) (the design,
   archived after going to Cursor) and its
   execution, the SKILL.md source already carries the additive per-session-dir
   layer, the pointer-retention regression guard, and the migration note — but only
   in *source*, not redistributed. This plan finalizes + ships them.

3. **General cleanup.** While in the file, tidy structure/dedupe — no behavior change.

**Where to execute:** a **fresh Claude Code session rooted in the skills repo**, NOT
a CCVC session. (The session that authored this plan is polluted with the full
design rationale — great for *writing* the plan, untrustworthy for *executing* it or
*testing* the skill, exactly as the session-scoped pollution lesson showed.)

## Approach

The invocation rewrite and the session-scoped edits **touch overlapping sections**
(State file, handling steps, echo contract), so do them as one coherent pass per
section rather than two sweeps that fight each other. Sequence: fix invocation truth
first (it reshapes the vocabulary everything else is written in), then reconcile the
session-scoped edits into the corrected vocabulary, then tidy.

The skill is **GLOBAL and multi-surface** (`modes/chat`, `modes/cowork`,
`modes/code`). All three surface variants must end up documenting `/modes <verb>`
consistently; each keeps its own degradation behavior. The `code` variant is the
marketplace plugin — redistribution (`redistribute`) is the combined install step
covering modes + /plans together.

## Files to modify

- `../skills-anthropic/modes/code/skills/modes/SKILL.md` — primary: invocation
  rewrite + finalize session-scoped + tidy.
- `../skills-anthropic/modes/chat/SKILL.md`, `../skills-anthropic/modes/cowork/SKILL.md`
  — propagate the invocation vocabulary (surface-variants todo).
- `../skills-anthropic/modes/code/.claude-plugin/plugin.json` — version bump if the
  marketplace cache keys on version (redistribute).

## Implementation details

### The invocation rewrite (the crux)

Verb shape DECIDED: **mode-as-verb** (the mode name is the verb to enter). Mapping
from today's documented (broken) forms → corrected `/modes <verb>` forms:

```
/enterMode plan ./doc   →   /modes plan ./doc      (mode name IS the verb)
/enterMode agent        →   /modes agent           (mutex: exits plan)
/enterMode sbs          →   /modes sbs
/exitMode sbs           →   /modes exit sbs         (explicit exit for compose-modes)
/exitMode plan          →   /modes clear            (or enter the other mutex mode)
/listModes              →   /modes list
/clearModes             →   /modes clear
```

Reserved verbs: any **mode name** (enter it), plus **`exit <mode>`**, **`clear`**,
**`list`**. All lowercase (casing rule). Every section written in the old vocabulary
must be rewritten: the **directive table**, the **echo contract** examples, the
**natural-language mappings**, the **help cheat-sheet**, and the **numbered handling
steps**. The skill's *behavior* (mutex, compound modes, echo format) is unchanged —
only how invocation is spelled. `/enterMode` etc. survive only as soft
natural-language aliases.

### Reconcile with session-scoped (already in source)

The State-file section and handling steps already carry the per-session-dir layer +
pointer guard + migration. After the invocation rewrite, re-read those to ensure
they speak the corrected vocabulary and don't contradict it.

## Edge cases

- **Backward-compat aliases** — if any users/muscle-memory rely on `/enterMode`,
  decide whether to keep those as *recognized natural-language aliases* (the skill
  already maps NL phrasings) vs. removing them entirely. Lean: keep as soft aliases,
  document `/modes <verb>` as canonical.
- **Surface drift** — the three surface variants must not diverge on invocation.
- **Pollution-free verification** — the post-reinstall test MUST use a session with
  no knowledge of this design (a naive fork/terminal), or it proves nothing (per the
  session-scoped pollution lesson).

## What we are NOT doing

- **Not adding new mode behaviors** (user scoped this as "session-scoped + cleanup",
  no new features). If new behavior is wanted later, it's a separate plan.
- **Not changing mode semantics** (mutex, compose rules, echo format stay).
- **Not dropping the MEMORY.md pointer** (hook-less surfaces depend on it — the
  regression guard from the session-scoped work stands).

## Resolved decisions (locked with user)

- **Verb granularity** — RESOLVED: **mode-as-verb** (`/modes plan ./doc`,
  `/modes agent`, `/modes sbs`). Reserved verbs: any mode name (enter), `exit <mode>`,
  `clear`, `list`. Exit of plan/agent via the mutex or `/modes clear`.
- **Verb casing** — RESOLVED: plain verbs lowercase; proper-noun targets camelCase
  (so `/modes` verbs are all lowercase; `/plans toCursor` is the camelCase exception).
  Applies to both skills.
- **Alias retention** — RESOLVED: keep `/enterMode` etc. ONLY as soft
  natural-language aliases; `/modes <verb>` is canonical and the documented form.
- **Redistribution** — RESOLVED (changed from SBS): once both skills are built and
  old plan2cursor deleted, install both directly across all targets/surfaces in one
  combined pass (see `redistribute`). No step-by-step SBS gating — trading that
  safety-check for speed, a deliberate call.

## Open questions

- (None blocking.) Surface-variant parity and pollution-free post-install
  verification are covered by `surface-variants` and `redistribute` respectively.

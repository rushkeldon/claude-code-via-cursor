---
name: Plans-UI integration — bug fixes & subagent rewire
overview: "Two corrections to the shipped plans-UI integration (appcloud9.190). BUG: the phase pill never moves off 'collaborate' — selectPhase opens the dialog but never sets planPhase, and the dialog only sets it on commit-with-a-plan-path, which 'write' (no path) never has. FIX: set planPhase on click in selectPhase, for every phase. REWIRE: the subagent breakout was wrongly cancelled — I conflated 'extension spawns a subprocess' (infeasible) with 'the in-session agent delegates to a subagent via NL' (normal, in-band, what we designed). Replace the spawnPlanSubagent host degrade-notice with a CCVC natural-language prompt asking the running agent to spawn a model-overridden subagent for review/build and report back — which also restores review-return for free. CCVC-only; ends with BBPI."
todos:
  - id: pill-on-click
    content: "Fix the phase pill never leaving 'collaborate': in src/webview/components/PromptPane/PromptPane.tsx selectPhase(), set planPhase.value = phase for EVERY phase (on click), before opening the dialog — not only on dialog-commit-with-a-plan-path. Keeps the pill reflecting the selected phase immediately, including 'write' (which has no plan path)."
    status: pending
    phase: "bug"
  - id: ephemeral-confirm
    content: "Confirm (no code change expected) that planPhase in src/webview/state/plan_phase.ts persists ACROSS TURNS within a session and resets only on 'ready'/'newSession' — i.e. ephemeral means across extension runs/sessions, NOT across turns. Verify the effect doesn't reset it on unrelated activeMode re-emits."
    status: pending
    phase: "bug"
  - id: which-plan-top3-plus-select
    content: "Fix the which-plan picker rendering ALL plans as radios (PlanPhaseDialog.tsx line ~162 plans.map renders every planList entry → a huge radio list when many *.plan.md exist). Intended grammar: show only the TOP 3 by modification date as radios, then an 'other…' radio that reveals a native <select> (placeholder first option 'select a plan…', disabled+selected by default) listing all remaining plans — no custom dropdown component — then an editable full-path field for a target .plan.md. (toCursor keeps its existing archive-dir edit field.) Applies to every which-plan dialogue, not just toCursor."
    status: pending
    phase: "bug"
  - id: subagent-nl-rewire
    content: "Rewire the model-breakout path from the cancelled 'extension spawns a subprocess' framing to the correct 'in-session agent delegates via NL' design. In PlanPhaseDialog.tsx, the review/build 'pick a model' branch should send a CCVC natural-language prompt (sendCommand, ccvc:true) instructing the running agent to spawn a subagent at the chosen model to run /plans <verb> <path> (write report to dir for review) and report the gestalt back — NOT post spawnPlanSubagent."
    status: pending
    phase: "rewire"
  - id: remove-spawn-host-handler
    content: "Remove the now-dead spawnPlanSubagent host handler in src/webview.ts (the degrade-to-notice case ~line 479) since the dialog no longer posts that message. Confirm no other sender remains."
    status: pending
    phase: "rewire"
  - id: review-return-nl
    content: "Restore review-return: because the subagent runs in-band as the agent's own delegated work, its completion + verdict gestalt come back as the agent's normal turn output — no separate host plumbing. Ensure the NL prompt explicitly asks the subagent's result (report path + one-line gestalt) to be reported back to the conversation."
    status: pending
    phase: "rewire"
  - id: spike-subagent-capability
    content: "SPIKE: behaviorally confirm CCVC's wrapped Claude Code exposes a model-overridden subagent to the in-session agent. Send the NL spawn prompt for a trivial review and observe whether a subagent actually runs at the chosen model. Branch: works → done; if the wrapped CLI doesn't surface subagents or model-override, surface that finding (the inline 'in this session' path still delivers value) — do NOT fake it."
    status: pending
    phase: "rewire"
  - id: bbpi
    content: "Bump appcloud9.X in package.json to the next version, then compile, package, install the VSIX (BBPI)."
    status: pending
    phase: "release"
isProject: false
---

# Plans-UI integration — bug fixes & subagent rewire

## Problem / Context

The plans-UI integration shipped in `appcloud9.190` (see
[plans_ui_integration.plan.md](archive/plans_ui_integration.plan.md), executed earlier). Two
things need correcting:

**1. BUG — the phase pill never moves off `collaborate`.** Clicking `write…` opens the
dialog and the file-name question works, but the pill stays `collaborate`. Root cause, from
the live code:
- [PromptPane.tsx](src/webview/components/PromptPane/PromptPane.tsx) `selectPhase()` (line
  377) opens the dialog (`activePhaseDialog.value = phase`) but **never sets `planPhase`** for
  a non-collaborate phase.
- [PlanPhaseDialog.tsx](src/webview/components/PlanPhaseDialog/PlanPhaseDialog.tsx) sets the
  phase only on commit, and only **when there's a resolved plan path** (`if (p)
  setPhaseForPlan(p, phase)`, line 141). `write` *creates* a plan, so it has no path → that
  branch never fires. Net: nothing can move the pill to `write`.

The intended behavior (confirmed): **clicking a phase sets the pill to that phase immediately.**
Also confirmed: "ephemeral" means across **extension runs / sessions**, *not* across turns —
the in-memory phase should persist turn-to-turn within a session (it already does; this plan
just verifies it).

**2. REWIRE — the subagent breakout was wrongly cancelled.** During the build I cancelled
`subagent-spawn` after concluding "CCVC can't spawn a model-overridden subprocess." That
answered the *wrong* question. The design (brainstorm Option B) was never "the **extension**
spawns a subprocess" — it was "the **in-session agent** delegates to a subagent via natural
language," which happens routinely, is in-band, and is human-initiated (the user clicked a
model). I conflated the two actors. The correct implementation: the dialog sends a **CCVC
natural-language prompt** asking the running agent to spawn a model-overridden subagent to run
the verb and report back. That also restores `review-return` for free (the result returns as
the agent's normal turn output). The genuine remaining unknown is *behavioral*, not
feasibility: does CCVC's wrapped CLI expose a model-overridden subagent to the agent? — a spike,
not a wall.

## Approach

CCVC-only; no skill edits. Two clusters:

- **Bug:** one-line-ish fix in `selectPhase` to set `planPhase` on click for every phase; plus
  a no-code-change verification that the ephemeral state already persists across turns.
- **Rewire:** flip the model-pick branch in `PlanPhaseDialog` from posting `spawnPlanSubagent`
  to sending a CCVC NL delegation prompt; delete the dead host handler; confirm the result
  returns inline; spike the actual subagent capability behaviorally.

The `setPhaseForPlan(p, phase)` call on commit stays — it still usefully records the per-plan
registry entry — but it is no longer what drives the pill (the click does).

## Conventions & assumptions

- **Pill set on CLICK, for every phase** (including `collaborate`, which also clears the
  dialog). This is the source of truth for the pill; commit-time `setPhaseForPlan` is only for
  the per-plan registry, not the pill.
- **Ephemeral = across runs/sessions, not turns.** `planPhase` resets only on `'ready'` /
  `'newSession'` — confirmed correct; do not add a per-turn reset.
- **Subagent = the AGENT delegates, not the extension spawns.** The breakout is a CCVC NL
  prompt over the normal send path (`sendCommand`, `ccvc:true`) — in-band, human-initiated,
  compliance-clean. The extension spawns nothing.
- **Still current-not-fence:** "in this session" remains the top, always-available option;
  picking a model is the delegated-subagent path.
- Assumes the wrapped Claude Code exposes a model-overridden subagent to the in-session agent;
  the spike confirms it. If not, the inline path stands alone and we surface the limitation.

## The steps

### bug

1. **`pill-on-click`** — [PromptPane.tsx](src/webview/components/PromptPane/PromptPane.tsx)
   `selectPhase()` (line 377). Set `planPhase.value = phase` for every phase at the top, before
   the dialog opens:
   ```js
   function selectPhase(phase: PlanPhase) {
     setPhaseMenuOpen(false);
     planPhase.value = phase;            // pill reflects the pick immediately
     if (phase === "collaborate") { activePhaseDialog.value = null; return; }
     activePhaseDialog.value = phase;
   }
   ```
   WHY: the pill must track the selected phase regardless of dialog commit / plan path. DONE-WHEN:
   clicking `write…` (and every other phase) moves the pill to that verb immediately; clicking
   `collaborate` returns it to baseline.

2. **`ephemeral-confirm`** — [plan_phase.ts](src/webview/state/plan_phase.ts). Verify (expect NO
   change) that `planPhase` persists across turns and resets only on `'ready'`/`'newSession'`,
   and that the `activeMode` effect doesn't spuriously reset it on unrelated re-emits (it guards
   on a real mode *transition* via `prevMode`). WHY: confirm "ephemeral across runs, not turns"
   already holds. DONE-WHEN: a phase picked in one turn still shows in the next turn (same
   session); reload resets to `collaborate`.

### rewire

3. **`subagent-nl-rewire`** —
   [PlanPhaseDialog.tsx](src/webview/components/PlanPhaseDialog/PlanPhaseDialog.tsx), the
   review/build commit branches that currently `post({ type: "spawnPlanSubagent", … })` (lines
   ~126, ~136). Replace with a CCVC NL prompt via `sendCommand` (so it renders as a CCVC card,
   in-band), e.g.: *"Spawn a subagent using model `<id>` to run `/plans <verb> <path>`
   <for review: writing the report to `<dir>`>; when it finishes, report back the report path
   and a one-line verdict gestalt."* WHY: the agent delegating to a subagent is the actual
   design — in-band, model-overridable, compliance-clean. DONE-WHEN: picking a model sends a CCVC
   NL delegation prompt naming the model + verb + path; no `spawnPlanSubagent` is posted.

4. **`remove-spawn-host-handler`** — [webview.ts](src/webview.ts), delete the
   `case "spawnPlanSubagent"` degrade-notice handler (~line 479) now that nothing posts it. WHY:
   dead code; the NL path supersedes it. DONE-WHEN: `grep spawnPlanSubagent src/` returns zero
   hits; compile clean.

5. **`review-return-nl`** — ensure the NL prompt (step 3) explicitly requests the subagent's
   **report path + one-line gestalt** be reported back to the conversation. No separate host
   plumbing — the result arrives as the agent's normal turn output. WHY: restores review-return
   in-band. DONE-WHEN: the delegation prompt asks for the gestalt return.

6. **`spike-subagent-capability`** (SPIKE) — behaviorally test: trigger the review breakout at a
   chosen model on a trivial plan and observe whether a subagent **actually runs at that model**.
   **Branch:** (a) it works → done; (b) the wrapped CLI doesn't expose subagents or
   model-override → surface that finding plainly (the inline "in this session" path still
   delivers value), do NOT fake it. WHY: this is the one real unknown — behavioral, not
   feasibility. DONE-WHEN: either a subagent runs at the chosen model (confirmed), or the
   limitation is surfaced with the inline path intact.

### release

7. **`bbpi`** — bump `appcloud9.X` to the next version, `npm run compile`,
   `npx @vscode/vsce package --no-dependencies`, `cursor --install-extension <vsix> --force`.
   DONE-WHEN: new VSIX installs; version incremented.

## Out of scope

- **No `plans`/`modes` SKILL.md edits** — CCVC-only.
- **No new picker phases or dialog fields** — fixing/ rewiring existing behavior only.
- **Don't reintroduce auto-flip / NL-intent detection** — the pill is still a picker; it reflects
  CLICKS, not prose. (This plan makes click→pill work; it does NOT add prose sniffing.)
- **Don't build an extension-side subprocess spawner** — the subagent is the agent's own NL
  delegation, never the extension launching Claude.
- **Don't touch the difficulty-rating live-turn** (still deferred) — the ladder default suggestion
  stands.
- **Don't edit `doc/archive/*`.**

## Verification

- Clicking any phase (esp. `write…`) moves the pill to that verb immediately; `collaborate`
  returns to baseline; the phase persists across turns and resets on reload.
- Picking a model in review/build sends a CCVC NL delegation prompt (CCVC card) naming
  model+verb+path and asking for the gestalt back; `grep spawnPlanSubagent src/` → zero hits.
- `npm run compile` clean; new VSIX installs.
- **Spike outcome recorded:** either a model-overridden subagent demonstrably runs, or the
  limitation is surfaced with the inline path working.
- **Escape hatch:** if the subagent capability isn't there (spike branch b), STOP short of
  claiming the breakout works — ship the pill fix + inline path, and note the breakout as
  pending the capability.

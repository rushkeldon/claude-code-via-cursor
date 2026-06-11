---
name: Settings-driven plan/agent modes + skill-bundling deliberation
overview: "Two related threads. (1) Make the prompt mode picker fully settings-driven with sensible agent/plan defaults, and gracefully fall back to today's built-in behavior when the setting is empty/falsy — so the menu is always present and always does something, while letting power users point it at other skills/commands. (2) Capture (NOT yet decide) the open deliberation about how the modes/plan2cursor skills are bundled with the extension and how hard to push users to install them."
todos:
  - id: modes-settings-audit
    content: "Audit current ccvc.modes.items wiring (package.json default, settings.ts fallback, webview modeItems/activeMode) and document the exact gap between what exists and the desired empty/falsy → built-in-fallback behavior"
    status: pending
  - id: modes-settings-fallback
    content: "Implement: when ccvc.modes.items is empty/absent/falsy, the picker falls back to the current built-in agent+plan behavior (never an empty or dead menu); when set, it drives the configured commands"
    status: pending
  - id: modes-settings-defaults
    content: "Confirm/define the default agent + plan entries (id/label/command) and make the menu always present + always actionable, with plan's dir configurable"
    status: pending
  - id: skill-bundling-decision
    content: "DELIBERATION ONLY (do not implement): write up options + tradeoffs for how the modes/plan2cursor skills are bundled and how hard to push installation; reach a recommendation, not a forced side-load"
    status: pending
isProject: false
---

# Settings-driven plan/agent modes + skill-bundling deliberation

## Background

Two threads surfaced together; this plan captures both so neither is lost. The
first is concrete UI/settings work. The second is an unresolved product
deliberation we explicitly do **not** want to decide hastily.

### Thread 1 — the mode picker should always be present and always do something

The prompt pane has a **mode picker** (the Cursor-style pill: icon + label +
chevron) already driven by settings: `ccvc.modes.items`, an array of
`{ id, label, command }`. Clicking an item sends its `command` as a visible turn
(e.g. `/modes plan ./doc`); the active-mode pill reflects the *real* mode read
from the modes skill's `active_modes.md` (the `activeMode` signal), not an
optimistic toggle.

What exists today (verified):
- **package.json** ([package.json](../package.json)) contributes
  `ccvc.modes.items` with defaults `{agent: "/modes agent"}` and
  `{plan: "/modes plan ./doc"}`.
- **src/settings.ts** ([src/settings.ts](../src/settings.ts)) has a matching
  `DEFAULT_MODE_ITEMS` fallback and ships `modes.items` to the webview in
  `sendCurrentSettings()`.
- **src/webview/state/settings.ts** ([src/webview/state/settings.ts](../src/webview/state/settings.ts))
  holds `modeItems` (with its own built-in fallback) and `activeMode`.

So the picker is **already settings-driven with agent/plan defaults**. The desired
behavior the user articulated — *"if it's empty or falsy in settings we just do
what we're doing now, but let the user point it at some other skill/command"* — is
therefore mostly a matter of **hardening the empty/falsy fallback** and confirming
the menu is never empty or dead. The intent:

- The menu is **always present** and **every item always does something**.
- **Empty/absent/falsy `ccvc.modes.items` → fall back to the built-in agent+plan
  behavior** exactly as today (no empty menu, no no-op clicks).
- **Non-empty → drive the user's configured commands** (which can point at other
  skills, slash commands, or mode directives — not just agent/plan).
- Plan's directory stays configurable (the default carries `./doc`).

### Thread 2 — how should the skills be bundled, and how hard to push install?

The extension's behavior leans on skills (`modes`, `plan2cursor`, and the mode
directives they implement). Open tension the user wants captured, **not yet
resolved**:

- **Don't force a side-load.** Loading skills by force feels wrong; the user wants
  them loaded **the natural way**, but really does want them present.
- **Skills are the current best practice** — and a key upside is that a skill
  installed for the extension is **also inherited by plain Claude Code sessions
  outside the extension**. Using the extension thereby *teaches* the skill and its
  syntax, which then pays off everywhere. Folding the skills into the extension as
  private/built-in behavior would lose that spillover.
- **But** relying on a skill the user hasn't installed means the extension's mode
  features silently don't work. How hard to push? Options range from "detect +
  gently offer to install" to "hard-require." The user is wary of being too
  opinionated ("probably too opinionated… I need to noodle how hard to push").

This thread is a **decision to reach deliberately**, not code to write now.

## Approach

Split cleanly: Thread 1 is a small, safe settings-hardening task we can implement;
Thread 2 is a write-up-the-options task that ends in a recommendation, with no
code and no forced installation.

### Thread 1 implementation sketch

The wiring already exists end to end; the work is mostly defensive:

1. **Audit** (`modes-settings-audit`) — confirm the three layers agree and find
   where an empty/falsy `modes.items` could produce an empty or dead menu (e.g.
   user sets `ccvc.modes.items: []` explicitly — does the fallback kick in, or does
   the picker render empty?). `config.get(..., DEFAULT)` only substitutes the
   default when the key is **absent**, NOT when it's an explicit empty array — so
   an explicit `[]` likely yields an empty menu today. That's the bug to fix.
2. **Fallback hardening** (`modes-settings-fallback`) — treat empty/whitespace/
   non-array `modes.items` as "use built-in defaults," in BOTH `settings.ts`
   (host) and `state/settings.ts` (webview), so neither layer can render an empty
   picker.
3. **Defaults + always-actionable** (`modes-settings-defaults`) — keep agent + plan
   as the built-in pair; ensure each item's `command` is non-empty before it's
   clickable (skip/disable blank-command items rather than sending an empty turn).

### Thread 2 — deliberation output (no implementation)

`skill-bundling-decision` produces a short written comparison, e.g.:

- **A. Detect + offer.** On activation, check whether the modes skill is installed
  (its `active_modes.md` path / skill presence). If absent, surface a one-time,
  dismissible notice: "Install the CCVC modes skill to enable plan/agent modes
  [Install] [Not now]." Natural install path; no force; preserves the
  outside-the-extension spillover. Picker still works for raw slash commands even
  without it.
- **B. Built-in fallback behavior.** Implement the mode semantics inside the
  extension so it works skill-or-not, but ALSO ship/recommend the skill for the
  spillover. Heavier; risks divergence between the built-in and skill behavior.
- **C. Hard-require.** Refuse to enable mode features without the skill. Cleanest
  contract, most opinionated — the user is wary of this.
- **D. Do nothing special.** Document the skill as a prerequisite; rely on the
  empty/falsy fallback (Thread 1) so the picker degrades gracefully when the skill
  is absent.

Recommendation to land in the write-up (subject to user): **A + D** — graceful
degradation (Thread 1) as the floor, plus a gentle detect-and-offer, never a
forced side-load. Keep skills as the install mechanism so plain Claude Code
sessions inherit them.

## Files to modify (Thread 1 only)

- [package.json](../package.json) — the `ccvc.modes.items` contribution + defaults
  (already present; confirm shape, maybe tighten description).
- [src/settings.ts](../src/settings.ts) — `DEFAULT_MODE_ITEMS` + `sendCurrentSettings`;
  add empty/falsy → default coercion.
- [src/webview/state/settings.ts](../src/webview/state/settings.ts) — `modeItems`
  fallback; guard against rendering an empty/dead menu.
- (Picker component) — ensure blank-command items aren't clickable / don't send an
  empty turn.

## Edge cases

- **Explicit empty array** `ccvc.modes.items: []` — must fall back to built-ins,
  not render an empty menu (the likely current gap).
- **Item with blank `command`** — don't send an empty turn; skip or disable it.
- **active-mode pill vs. configured items** — the pill reflects the *real* mode
  from `active_modes.md`; configured items that aren't agent/plan (other skills)
  may not map to a pill state. Decide how the pill renders for non-mode commands
  (likely: leave the pill on its last real mode; the item still fires its command).
- **Skill absent entirely** — picker should still send raw slash commands; the mode
  directives just won't resolve until the skill is installed (Thread 2).

## What we are NOT doing

- **Not force-installing or side-loading skills.** Natural install path only.
- **Not deciding Thread 2 in this plan** — it produces a written recommendation;
  the actual choice is the user's, made separately.
- **Not abandoning skills in favor of built-in-only behavior** — the
  outside-the-extension inheritance is a feature we want to keep (it's the reason
  to stay skill-based).
- **Not touching the compliance posture** — none of this adds auth/credential
  handling; it's UI + settings + skill-presence detection.

## Open questions

- **How hard to push skill install?** The core Thread-2 question. Lean gentle
  (detect + offer), but the user wants to noodle on it.
- **Non-mode picker items** — should the picker support arbitrary skills/commands
  as first-class (with their own icons), or stay focused on mode directives plus an
  "other" escape hatch?
- **Skill-presence detection mechanism** — how does the extension reliably tell
  whether the modes skill is installed? (Path probe for `active_modes.md`? A skill
  manifest check? The host already caches the modes path — reuse that.)
- **Does Thread 1 ship independently of Thread 2?** Likely yes — the fallback
  hardening is safe and useful regardless of the bundling decision.

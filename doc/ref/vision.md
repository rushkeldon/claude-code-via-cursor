# Vision & design intent

*Private design-intent doc — not user-facing. Future plans should align against this.
It captures the "why" behind the product so decisions stay coherent as the feature
set grows. Keep it short and opinionated; prune what stops being true.*

## North star

**Build the tool a Claude Code power user defects to.** The bar is not "a chat box
that happens to call `claude`." The bar is: the best surface in existence for driving
Claude Code — better to live in than the terminal, and better than any first-party
agent UI (Claude Desktop / Cowork in particular).

The unspoken target is a **Cursor-killer**: what a best-in-class agentic coding
environment looks like when it combines Claude Code's full agency with a genuinely
good editor-native UI. We're building our idea of what Anthropic *should* be shipping.

## Why we can win (the three wedges)

1. **No second-class subset.** First-party agent UIs feel like sealed appliances —
   you only get the curated slice the vendor chose to expose. We do the opposite:
   expose *everything the CLI can do*, in a nicer shell. The slash-command / skill
   pass-through over the raw `stream-json` channel is the concrete embodiment of
   this — if `claude` can do it headlessly, you can do it here, inline. Protect this
   property. Every feature should ask "does this preserve full Claude Code reach, or
   quietly fence it off?"

2. **The Cursor `plan.md` loop is the differentiator.** Cowork has no plans panel;
   Cursor has no Claude Code depth. We sit on the seam: Claude Code's agency *plus*
   Cursor's native plan UI ticking off todos live as the agent works. Neither
   competitor can tell this story. Lean into it — the plan → review → approve →
   execute loop (via the `modes` + `plan2cursor` skills) is a headline, not a
   footnote. A live demo of checkboxes completing while the agent runs sells it
   harder than any prose.

3. **Never upend the session.** Sealed tools feel stateful-but-fragile — change a
   setting and you're unsure what session you're even in. Our in-band model / effort
   / thoughts switching keeps the conversation perfectly continuous. This reads as
   *polish* to a casual user and as *this person gets it* to a power user. It's a
   quality bar, not just a feature — guard it fiercely as scope grows.

## The defining distinction: capability parity, not keystroke parity

This is the principle that resolves most "should we build X?" arguments, so it
gets its own section.

Parity with Claude Code splits into two layers that are easy to conflate:

- **Capability parity (mandatory).** Everything Claude Code *can do*, you can do
  here. This is non-negotiable — it's wedge #1.
- **Interaction translation (the whole point).** You do **not** have to reproduce
  CC's *TTY-keyboard interaction* to honor a capability. You expose the same
  capability through a **GUI-native affordance**.

The canonical example is `@`. In the CLI, `@` is a TTY affordance: type it, get
an inline fuzzy file-mention autocomplete. The *capability* is "pull a file into
context." We honor the capability with a **paperclip button** (click → picker),
plus drag-drop, plus simply typing a path (which CC's Read tool handles natively)
— none of which reproduce the `@` keystroke, all of which deliver the capability.
A clicked button labeled `@` would be the *wrong* translation; the glyph implies
typing.

The rule that falls out, and the corollary that bounds it:

- **For every CC affordance, identify the *capability*, then ask "what's the
  GUI-native way to offer it?"** — rather than reproducing the keystroke. Apply
  this to `!` shell mode, `Shift+Tab` mode cycling, `Ctrl+R` history, etc.
- **Never create new functionality, and never overload what CC already does.** If
  CC has it, we drive *CC's* version — its commands, its control protocol, or the
  slash-command pass-through. We wrap and present; we don't fork behavior or
  sideload (e.g. hand-writing CC's internal config formats — the predecessor's
  mistake). The only sanctioned net-new pieces are the two companion skills
  (`modes`, `plan2cursor`).

## Design principles (decision tie-breakers)

- **Parity first, polish on top.** When a Claude Code capability has no home in the
  UI yet, the default is to surface it — not to decide the user doesn't need it.
- **In-band over respawn.** Prefer the control protocol (in-session state changes)
  to killing/restarting the process. Continuity is the product.
- **The terminal is the escape hatch, not the destination.** Breakout exists for the
  genuine TTY cases; everything else should work in-panel.
- **A power user should never feel friction.** If a flow is faster in the raw CLI
  than here, that's a bug in our UX, not an acceptable trade-off.
- **Editor-native, not a bolted-on web app.** Use Cursor/VS Code's own surfaces
  (plans panel, native cards, activity bar) rather than reinventing them.
- **Translate the keystroke, don't reproduce it.** A TTY affordance (`@`, `!`,
  `Shift+Tab`) is a *capability* wearing a keyboard costume. Strip the costume,
  keep the capability, give it a GUI-native affordance. (See the capability-vs-
  keystroke section above.)

## Non-goals (for now)

- Not a general multi-provider chat client — this is a Claude Code surface.
- Not reimplementing Claude Code features that the CLI already does well; we wrap and
  present, we don't fork behavior. No new functionality, no overloading CC, no
  sideloading its internal config formats — the two companion skills are the only
  sanctioned net-new pieces.
- Not chasing distribution/marketplace polish while it's a personal build — get the
  experience right first.

## Open frontiers (where the vision is still unbuilt)

- **Project-scoped memory / cross-session search** — Cowork lets a conversation
  search sibling conversations in a project. We have per-session history on disk but
  no cross-session retrieval yet. This is a natural next wedge (see the History
  panel). The full transcripts are already persisted as JSON, so the data exists —
  it just isn't searchable.
- Anything that deepens the plan loop or tightens the "feels like one continuous
  session" guarantee is on-mission almost by definition.

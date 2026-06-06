# Bug list

Running list of known issues / polish to address. All current entries are
webview UI work.

The shared reference for the height items below is the **READ tool row** — the
compact single-row card rendered by `ToolUseMessage`
(`src/webview/components/ToolMessage/ToolMessage.tsx`, `.tool-header` in
`ToolMessage.less`). It's the tightest card in the conversation; several other
cards are needlessly taller and waste vertical space in a long scroll.

---

## Bug 1 — Collapsed Q&A card is too tall

**Symptom:** When the AskUserQuestion card collapses after the questions are
answered (the `CLAUDE Q & A — ANSWERED` header-only state), it's noticeably
taller than it needs to be — more vertical padding around the header than a
plain tool row.

**Desired behavior:** When collapsed, the Q&A card's header row should be the
**same height as the READ tool row** (`.tool-header`). Conserve vertical space —
a long conversation has many of these and the extra height adds up.

**Notes / direction:**
- Target the collapsed/resolved state only — `.ask-user-question.decided` with
  `bodyHidden` true (`AskUserQuestion.tsx` ~line 195). The expanded state can
  keep its current sizing.
- This is a padding/line-height match in `AskUserQuestion.less` against whatever
  `.tool-header` uses. Don't change the pending (live) card.

---

## Bug 2 — Thinking pill and stall hint are too tall

**Symptom:** The collapsed **THINKING…** pill (`ThinkingPill`) and the
**"Claude has been silent for Ns"** stall notification (`StallHint`) both render
taller than the READ tool row.

**Desired behavior:** Both cards should match the **READ tool row height**
(`.tool-header`), same as Bug 1 — compact, single-row.

**Notes / direction:**
- ThinkingPill: `src/webview/components/ThinkingPill/ThinkingPill.tsx` /
  `.less` — the `.thinking-pill` / `.thinking-pill-summary` row. Match the tool
  row padding/height for the collapsed summary; expanded content unaffected.
- StallHint: `src/webview/components/StallHint/StallHint.tsx` / `.less` — the
  `.stall-hint` row.
- Same approach as Bug 1: align padding/line-height to `.tool-header`.

---

## Bug 3 — Stall notification needs a dismiss (X) button

**Symptom:** The "Claude has been silent for 30s. It may be processing a large
response." hint (`StallHint`) often fires as a false positive. The user
recognizes it as such and wants to dismiss it manually rather than wait for it
to clear.

**Desired behavior:** Add a small close (X) button at the **top-right** of the
stall-hint card. Clicking it dismisses the hint immediately for the current
occurrence.

**Notes / direction:**
- `StallHint.tsx` drives visibility off the `stallMessage` signal; it's already
  cleared by `stallHintClear` and by `setProcessing` going false. The X just
  needs to set `stallMessage.value = null` locally (webview-only dismiss — no
  host round-trip required).
- It's a per-occurrence dismiss: a later `processStalled` message (e.g. a new
  stall on the next turn) should be free to show the hint again. No need to
  suppress future hints.
- Style the X to sit top-right of `.stall-hint`; keep the row compact per Bug 2.

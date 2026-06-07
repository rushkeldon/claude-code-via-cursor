---
name: Collapsible message cards
overview: >
  Make every message card collapsible with the same ▸/▾ chevron used in
  AskUserQuestion, via one shared primitive. Cards that already have bespoke
  collapse behavior are left untouched; the new affordance is added to the cards
  that currently can't collapse. State is driven by an `initialDisplayed` prop
  (true = open, default).
todos:
  - id: collapsible-primitive
    content: "Build a shared Collapsible primitive (chevron header + body) mirroring AskUserQuestion's ▸/▾; prop initialDisplayed (true=open, default true)"
    status: pending
  - id: chatmessage-collapse
    content: "Wire collapse into ChatMessage (covers Claude, user, system, error, tool-use cards) — header click toggles, chevron in header"
    status: pending
  - id: notice-collapse
    content: "Add collapse to NoticeCard (standalone, currently no collapse)"
    status: pending
  - id: verify-no-regressions
    content: "Confirm the 3 bespoke collapsers (AskUserQuestion, ToolMessage file-path, ToolResult) are untouched and still behave identically"
    status: pending
isProject: false
---

# Collapsible message cards

## Background

Long responses (from Claude or from a pasted/attached prompt) and verbose tool
output force a lot of scrolling to see what's around them — the Slack
animated-GIF problem, where the saving grace is a collapse arrow. We want that
arrow on **every** card: Claude replies, user prompts, tool-use, tool-results,
system/error/notice cards — collapse and re-expand at will.

The reference is the existing **AskUserQuestion** collapse: a resolved card shows
a `▸` (collapsed) / `▾` (open) chevron in its header, clicking the header
toggles, and the body is hidden when collapsed
([AskUserQuestion.tsx](../src/webview/components/AskUserQuestion/AskUserQuestion.tsx)
lines ~130, 194-209). We replicate that look/interaction everywhere.

## Key design decisions (locked)

- **Shared primitive, not per-card duplication.** One `Collapsible` (or a
  `useCollapsible` hook + chevron) so the chevron, toggle, and behavior are
  identical across all cards and easy to tune in one place.
- **`initialDisplayed` prop** — `true` = displayed/open/expanded, `false` =
  collapsed/closed. **Defaults to `true`.** Naming reads right at the call site:
  `initialDisplayed={false}` = "starts collapsed." (Maps the user's
  displayed/dismissed mental model onto the open/closed toggle.)
- **No behavior change to existing collapsers.** AskUserQuestion (auto-collapse
  on resolve), ToolMessage (file-path tools collapse to a one-liner), and
  ToolResultMessage (starts collapsed) all keep their **bespoke** logic untouched.
  We only add the new affordance to cards that currently *can't* collapse.
- **New collapse affordances start OPEN** (`initialDisplayed` default), so nothing
  the user reads every turn (Claude replies, their own prompts) starts folded.
- **No global "collapse all"** this pass — per-card only. (Deferred; would need
  shared collapse state. Noted as a future follow-up.)

## Approach

### 1. Shared `Collapsible` primitive (`collapsible-primitive`)

A small reusable piece — likely a `useCollapsible(initialDisplayed = true)` hook
returning `{ displayed, toggle }` plus a shared chevron element, OR a
`<Collapsible header=… initialDisplayed=…>` wrapper. Mirror AskUserQuestion's
exact chevron glyphs (`▾` open / `▸` collapsed), the `--toggle` header class
(`cursor`, `role="button"`, title "Expand"/"Collapse"), and the
`.ask-question-chevron` styling (10px, `--vscode-descriptionForeground`). Put the
chevron CSS in a shared place so all cards match.

Decision detail: ChatMessage owns its header already, so the cleanest fit is a
`useCollapsible` hook ChatMessage calls (rather than a wrapper that fights the
existing header markup). NoticeCard, which has no ChatMessage header, can use the
same hook with its own header row.

### 2. Wire into ChatMessage (`chatmessage-collapse`)

[ChatMessage.tsx](../src/webview/components/ChatMessage/ChatMessage.tsx) is the
shared wrapper for **UserMessage, ClaudeMessage, SystemMessage, ErrorMessage, and
ToolMessage** — so one edit here makes all five collapsible. Add the chevron to
`.message-header`, make the header clickable to toggle, and hide
`.message-content` when not displayed. Accept an `initialDisplayed?: boolean`
prop (default `true`) so individual callers can override later if wanted.

Caveat: ToolMessage routes through ChatMessage *and* has its own file-path
one-liner collapse. Adding a header-level collapse on top must not break that —
the header collapse hides the whole content (including the one-liner); the
existing file-path logic governs what the *expanded* content looks like. Verify
they compose, don't conflict (see item 4).

Header note: the header also holds the copy button — ensure clicking copy doesn't
also toggle collapse (stop propagation on the copy button, or only bind the
toggle to the chevron + label, not the whole header).

### 3. NoticeCard (`notice-collapse`)

[NoticeCard](../src/webview/components/NoticeCard/NoticeCard.tsx) is standalone
(no ChatMessage). Add the same hook + chevron to its header so notices collapse
too. (Low priority — notices are short — but included for "everything collapses"
consistency.)

### 4. Verify no regressions (`verify-no-regressions`)

Explicitly confirm the three bespoke collapsers are **unchanged**:
- **AskUserQuestion** — still auto-collapses on resolve, pending cards never
  collapse, expand still works.
- **ToolMessage** — file-path tools (Read/Edit/Write) still collapse to the
  single-line path; the new header collapse layers cleanly on top.
- **ToolResultMessage** — still starts collapsed, expands as before.

## Files to modify / add

- **new** shared primitive — `useCollapsible` hook (+ chevron) in a shared
  location (e.g. `src/webview/components/Collapsible/` or a hooks file), with the
  chevron CSS.
- [ChatMessage.tsx](../src/webview/components/ChatMessage/ChatMessage.tsx) +
  `.less` — chevron in header, toggle, hide content when collapsed,
  `initialDisplayed` prop.
- [NoticeCard](../src/webview/components/NoticeCard/NoticeCard.tsx) — same hook.
- **Untouched (verify only):** AskUserQuestion, ToolMessage, ToolResultMessage.

## Edge cases

- **Copy button vs. toggle** — header click toggles collapse; the copy button in
  the same header must not also toggle (scope the click handler / stopPropagation).
- **ToolMessage double-collapse** — header collapse (new) vs. file-path one-liner
  (existing) must compose, not fight.
- **Streaming** — a Claude card collapsed mid-stream: text keeps arriving into
  hidden content; expanding shows the full reply. Fine, but confirm collapse
  while streaming doesn't break the live-render. (Default is open, so this is an
  intentional user action, not a default.)
- **Scroll/auto-scroll** — collapsing a tall card changes height; make sure the
  MessagesList sticky-scroll logic doesn't fight a manual collapse (it keys off
  new entries + bottom-stick; a collapse is neither, so likely fine — verify).

## What we are NOT doing

- **Not** changing any existing collapse behavior (the three bespoke collapsers).
- **Not** adding a global collapse-all/expand-all (deferred).
- **Not** persisting collapse state across reload (per-card, in-memory; reload
  resets to `initialDisplayed`). Could add later if wanted.

## Open questions

- Hook vs. wrapper component for the primitive — lean **hook** (`useCollapsible`)
  since ChatMessage owns its header markup. Confirm during build.
- Does ToolResultMessage want to switch to the shared primitive for visual
  consistency of its chevron, or keep its current collapse UI? (Default: leave it;
  "no behavior change.")

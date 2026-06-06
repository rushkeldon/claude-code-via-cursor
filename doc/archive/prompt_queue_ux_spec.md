# Prompt Queue UX — feature spec

Status: **draft spec** (not yet planned/implemented)
Author: drafted 2026-06-05
Related code: `src/subprocess.ts` (`queuedTurns`, `runTurn`, `onTurnEnd`,
`stopProcess`/interrupt), `src/permissions.ts` (AskUserQuestion), webview
`PromptPane`, `src/webview/state/session.ts`.

## Problem

Today, when you send a prompt while a turn is in flight, the extension **silently
queues it** (`subprocess.ts` → `⏸️ turn queued`, `queuedTurns` array) and flushes
it at the next turn boundary (`onTurnEnd`). The mechanism is correct, but there is
**no UI affordance**: the prompt box clears, nothing shows that anything is
pending, and the user can't tell whether the prompt was lost, is waiting, or is
buried behind something. Two concrete failures observed:

1. **Invisible queue.** A user sent two prompts during an active turn; both were
   queued (`queueLen=2`) but the UI showed nothing, so they appeared to "vanish
   into the ether."

2. **The AskUserQuestion trap.** AskUserQuestion arrives as a `can_use_tool`
   control request (the CLI's protocol name; we already special-case it in
   `permissions.ts` via `tool_name === 'AskUserQuestion'`). While a question is
   pending, the **turn never ends** — so anything queued behind it can never
   flush until the question is answered. The user is stuck: the panel wants an
   answer, queued prompts pile up invisibly, and on answering they all fire
   back-to-back with no chance to reconsider.

We want the **Cursor behavior**: sending while busy shows a compact, peeking
"queued" card with its own send button; sending again (or clicking that button)
**interrupts** the current turn and sends the queued prompt immediately.

## How Cursor actually does it (researched 2026-06-05)

Confirmed against Cursor's 1.2 changelog + Cursor staff forum posts:

- **Send while busy = queue for after.** The queued message runs as a **fresh,
  separate turn** once the current task finishes. It is **not** injected into the
  in-flight turn, and it does **not** steer the running work. Queued items are a
  reorderable list. (Cursor 1.2 release notes.)
- **Second send / "Send immediately" = interrupt-and-run-now.** It **cancels the
  current run** and starts the new message as a new turn. This is what "stop and
  answer this now" feels like — and because the new turn still has the full
  conversation as context, it *looks* like the aside was picked up seamlessly.
- **"Consider alongside what you're doing" is NOT a thing in Cursor.** Live
  in-flight steering is one of their most-requested *unimplemented* features; their
  attempts at interrupt-y behavior caused duplicate-execution and abort bugs. This
  is also what `/btw` is in Claude Code (a parallel, ephemeral, context-only side
  question) — a **different feature**, deliberately out of scope here.

Lessons we adopt from Cursor's pain points:

1. **Make the queued state visible and unambiguous.** Cursor's #1 complaint was
   users not knowing whether they were in queue vs. send-immediately mode. Our
   peeking card shows the queued item directly — strictly better than a hidden
   setting. Lean into that; do not hide the mode behind a preference.
2. **Interrupt must be deliberate, never automatic.** Cursor's bugs came from
   interrupts firing unexpectedly. Plain **Send-while-busy ALWAYS queues**; only an
   explicit action (the card's **Send now**, or a deliberate second Send — see
   resolved Q2 below) ever interrupts.
3. **Guard against double-execution.** Cursor shipped a bug where an interrupted
   message ran once on interrupt *and* again after. Our `onTurnEnd` drain and the
   "Send now" path must not both fire the same queued item — see Edge cases.

Sources: Cursor 1.2 changelog (queued follow-ups + reorder); Cursor staff
(Dean Rie) forum posts on the "Send after current message" vs "Send immediately"
setting and the interrupt regression. (One third-party article claiming an
Enter/Alt+Enter/Cmd+Enter keymap is unverified and disregarded.)

## Goals

- Make a queued prompt **visible** the instant it's queued.
- Give the user **one-click "send now"** that interrupts the active turn and runs
  the queued prompt immediately (Cursor's send-again-to-interrupt).
- Let the user **edit or cancel** a queued prompt before it runs.
- Handle the **AskUserQuestion / permission-pending** case explicitly so prompts
  don't get trapped behind an unanswerable turn.

## Non-goals

- Not changing the CLI control protocol or the `can_use_tool` wire name (not ours
  to change). We only improve how *we* present it.
- Not building a multi-item visible queue editor in v1. One peeking card
  representing the queue (which may hold >1 item) is enough; see "Open questions"
  for multi-item.
- Not changing the single-process / single-writer invariants. This is purely a
  queue-visibility + interrupt-routing layer on top of the existing
  `queuedTurns` + warm-`interrupt` machinery.

## The interaction (happy path)

1. A turn is in flight (`processing === true`). The prompt box is active; the user
   types and hits **Send**.
2. Instead of vanishing, the prompt becomes a **queued card** — a slim, collapsed
   "peeking" card docked just above the prompt input, showing:
   - a truncated preview of the prompt text (one line),
   - a "queued" affordance/label,
   - a **Send now** button (the second-arrow), and
   - a small **✕ / cancel** control.
3. The prompt input clears and is ready for the next message.
4. **If the user hits Send again** (with new text in the box) OR clicks the card's
   **Send now**:
   - the current turn is **interrupted** (warm `interrupt` — process stays alive,
     verified behavior),
   - the queued prompt is sent immediately as the next turn.
5. If the user does nothing, the queued prompt flushes automatically at the
   natural turn boundary (`onTurnEnd`) — current behavior, now just visible.

## The AskUserQuestion / permission-pending case

This is the trap case and needs distinct handling. When an AskUserQuestion (or a
tool-permission request) is **pending**, the turn cannot end on its own — it is
*waiting on the user*. So:

- A prompt sent while a question is pending must **not** silently queue behind it
  with no escape. Options (pick in planning):
  - **(A) Block with a hint:** the prompt box shows "Answer the question above
    first" and the Send is a no-op (or routes focus to the question card). Safest,
    least surprising.
  - **(B) Queue + prominent affordance:** queue it as normal, but the queued card
    explicitly says "will send after you answer the question," and **Send now**
    means "treat this as the answer path is abandoned → interrupt + send." Since
    interrupting mid-AskUserQuestion may not cleanly produce a `result`, **Send
    now here should escalate to a hard cancel of the question turn** (Skull-like
    for that turn) then send.
- Whichever we choose, the key requirement: **the user must always have a visible,
  one-click way out** — never a silent trap.

Recommended default: **(A) for the pending-question case** (block + hint, point at
the question), because a queued prompt that can only flush *after* an answer is
inherently confusing; combined with **the peeking card for the normal
busy-but-no-question case**.

## Visual / component design

A new **`QueuedPrompt`** card component, rendered **inside the `PromptPane`**, in
the same row region as the model picker (the controls strip above the textarea).
It is NOT a separate panel between the chat and the input — it lives within the
prompt pane's chrome and **pokes up above the pane's top edge in z-space**,
overlapping the bottom of the chat history rather than pushing layout down.

Design intent (per product direction):

- **Looks like a user prompt bubble**, not a system widget — same visual language
  as a sent user message (so it reads as "this is your message, waiting"), but
  with a **`queued` badge**.
- **One line, ellipsized.** Shows only the first line of the prompt text,
  truncated with `…`. It must **not** grow the prompt pane height meaningfully —
  ideally it tucks **next to / alongside the model picker** in the existing
  controls row, taking no extra vertical space. If it can't fully fit inline, it
  **peeks** — overlapping upward in z-space over the chat history's bottom edge,
  so the prompt pane's own height stays put.
- **Transitions to a normal user message** once sent: when the queued item
  flushes (auto at turn end, or via Send now), it leaves the pane and appears in
  the transcript as a regular user prompt — i.e. the queued card is the same
  content "in waiting," then it becomes the real thing after send.

```
 chat history …
 …last assistant message…
        ┌──────────────────────────────────────────────┐   ← pokes up in z-space,
        │ [queued] okay i would like you to take a look… │     overlapping chat bottom
        └──────────────────────────────────────────────┘
┌─ PromptPane ───────────────────────────────────────────┐
│ [model ▾]   (queued chip may sit here, next to picker)  │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ prompt input …………………………………………………………        Send │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

- **Styling:** reuse the user-message bubble look; add a small **`queued` badge**
  (pill). Single-line, `text-overflow: ellipsis`. All colors via `--vscode-*`.
- **Z-space, not layout flow:** position it `absolute`/overlay relative to the
  prompt pane so it overlaps the chat above instead of reflowing it. The prompt
  pane does not get taller because of it.
- **Affordances on the card:**
  - **Send now** (▸) — interrupt the active turn + send this immediately.
  - **✕** — cancel/remove the queued item (drop from `queuedTurns`).
  - Clicking the text **expands** to the full prompt (and, later, edit).
- **Multiple queued items:** v1 shows the head item as the card + a count badge
  ("+1"); full reorderable list is a later phase (Cursor supports reorder; we can
  follow). Keep FIFO.
- The card appears **only while `processing === true`** and there is ≥1 queued
  item; otherwise the prompt pane looks exactly as it does today.

## The `onTurnEnd` contract (shared with `history_modal_upgrade.plan.md`)

This feature drains `queuedTurns` from `onTurnEnd`, which is **already a shared
contention point**: Phase 1/2 made `onTurnEnd` flush a pending silent query,
apply a deferred `set_model`, apply a deferred settings restart, and drain a
queued turn; the History-titles plan adds title generation via the same
`sendSilentQuery`/`onTurnEnd` seam. The two features MUST agree on this order
(authoritative copy lives in `history_modal_upgrade.plan.md`):

1. **Guard:** if the `result` is a **silent-query completion**
   (`awaitingSilentResult`) — e.g. a title query — do nothing else and return.
   Silent-query results must NOT drain the queue or apply deferred switches.
2. `isProcessing = false`; disarm watchdog; post `setProcessing:false`.
3. Title trigger (history plan) — issues a silent query, non-blocking.
4. Deferred `set_model`.
5. Deferred settings restart.
6. **Drain one queued turn** (this feature) — shift + run head of `queuedTurns`.

The step-1 guard is what prevents a title query from silently flushing a queued
prompt — the exact bug that motivated reviewing these two specs together. Both
specs must be implemented and tested against this single ordering.

## Behavior details / state

- **Source of truth** stays `queuedTurns` in `subprocess.ts`. The extension must
  emit the queue state to the webview whenever it changes:
  - on enqueue (`sendMessage` entry-guard path),
  - on flush (`onTurnEnd` drain),
  - on cancel.
- New **extension→webview** message, e.g.
  `{ type: 'queueState'; data: { items: Array<{ id: string; preview: string }> } }`
  (preview = first ~80 chars; `id` to target cancel).
- New **webview→extension** messages:
  - `{ type: 'sendNow' }` (or reuse a second `sendMessage` press) → interrupt +
    flush the head of the queue immediately.
  - `{ type: 'cancelQueued'; id: string }` → remove from `queuedTurns`, re-emit
    `queueState`.
  - (optional v1.1) `{ type: 'editQueued'; id; text }` → replace queued text.
- **Send-again-to-interrupt routing:** when `processing === true` and the user
  presses Send:
  - if the box has text → enqueue it, then (per Cursor) a *second* Send press
    interrupts and flushes; OR
  - simpler v1: Send-while-busy always enqueues + shows the card; the card's **Send
    now** is the explicit interrupt trigger. (Decide in planning: "second Send =
    interrupt" vs "only the card's button interrupts." The card button is less
    surprising; the double-Send matches Cursor muscle memory. Could do both.)
- **Interrupt mechanics:** reuse the verified warm `stopProcess()` (interrupt
  control request) — process stays alive, the in-flight turn ends with a
  `result`, then the queued prompt runs as the next turn. For the
  pending-question case, "send now" must instead **cancel the question turn**
  (the interrupt may not yield a clean `result` while a `can_use_tool` is
  outstanding) — verify during implementation.

## Edge cases

- **Double-execution guard (Cursor shipped this bug — avoid it):** "Send now"
  interrupts the active turn, which causes a `result` → `onTurnEnd`, which ALSO
  drains the queue. Both paths must not run the same head item. Implementation
  rule: "Send now" should **dequeue the head item itself and run it directly**,
  and `onTurnEnd`'s drain must be a no-op if the interrupt-triggered send already
  claimed it (e.g. guard by item `id`, or have Send now mark "manual flush in
  progress" so `onTurnEnd` skips one drain). Verify no item runs twice.
- **Queue holds multiple items + Send now:** Send now flushes the **head** (FIFO),
  interrupting the current turn. Remaining items stay queued and the card updates
  to the next head + "+N" badge.
- **Turn ends naturally while the card is showing:** the head item flushes via
  `onTurnEnd`; the card updates to the next item or disappears.
- **Cancel the last queued item:** card disappears; nothing else changes.
- **Skull while items are queued:** `queuedTurns` is cleared (existing behavior) —
  the card must clear too (drive off `queueState`).
- **Empty/whitespace prompt:** don't enqueue (match current Send guard).
- **Queued prompt with images:** the queue item already carries `images`
  (`queuedTurns` stores them); preview should indicate an attachment.
- **AskUserQuestion answered while a prompt is queued behind it (if we allow
  queuing in that case at all):** on answer → turn completes → queued prompt
  flushes. The card must make clear this will happen.

## Rollout / phasing suggestion

1. **Phase A — visibility (low risk):** emit `queueState`, render the peeking
   `QueuedPrompt` card with cancel. No interrupt behavior yet. This alone fixes
   the "vanished into the ether" problem.
2. **Phase B — send-now/interrupt:** wire **Send now** (and/or second-Send) to the
   warm interrupt + immediate flush.
3. **Phase C — AskUserQuestion guard:** the block-with-hint (or cancel-question)
   handling so prompts can't be trapped behind a pending question.
4. **Phase D (optional) — edit queued, multi-item list.**

## Resolved decisions

- **Second-Send semantics (was Q2) — RESOLVED:** plain **Send while busy always
  queues** (never auto-interrupts — matches Cursor's safe default and avoids their
  unexpected-interrupt bugs). Interrupting is an **explicit** action: the card's
  **Send now** button. (We MAY additionally allow a deliberate second Send to
  interrupt later, but the button is the canonical path; do not make plain Send
  ambiguous.)
- **Multi-item queue (was Q1) — RESOLVED for v1:** show the **head item** as the
  card + a **"+N" count badge**; FIFO. A full reorderable list is a later phase.
- **AskUserQuestion pending — RESOLVED:** **block-with-hint** (option A). While a
  question/permission is pending, Send does not queue silently; the box hints
  "answer the question above first" and points at the question card.

## Open questions (still need a decision / live test)

- **AskUserQuestion "send now":** if we later allow a queued item to override a
  pending question, "send now" must **hard-cancel the question turn** (interrupt
  may not yield a clean `result` while a `can_use_tool` is outstanding) — needs a
  live test before building Phase C beyond block-with-hint.
- **Naming/overload of `can_use_tool`:** purely internal/UX — do we want a clearer
  label in our own logs/messages (e.g. classify as `interactivePrompt` vs
  `toolPermission`) even though the wire name is fixed? Low priority, cosmetic.

## What we are NOT doing

- Not altering the single-process reuse, identity-guard, or cross-window-lock
  invariants from the session-lifecycle work.
- Not changing how AskUserQuestion is transported (still `can_use_tool` on the
  wire); only how we present and guard it.

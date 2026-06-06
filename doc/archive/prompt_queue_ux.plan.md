---
name: Prompt Queue UX — visible queued prompts + deliberate interrupt
overview: >
  Make queued prompts visible and controllable. Today a prompt sent during an
  active turn is silently queued (subprocess.ts queuedTurns) and flushed at
  onTurnEnd with no UI — so prompts appear to vanish, and anything queued behind
  a pending AskUserQuestion is trapped. Add a peeking "QueuedPrompt" card in the
  PromptPane (Phase A, visibility), a deliberate Send-now interrupt that flushes
  the queued prompt immediately via the warm interrupt (Phase B), and a
  block-with-hint guard for the pending-question case (Phase C). Phase D (edit /
  multi-item list) is optional/later. Source of truth stays queuedTurns; this is
  a visibility + interrupt-routing layer, not a change to the single-process or
  onTurnEnd invariants.
todos:
  - id: queue-state-message
    content: "Phase A — Add the extension→webview `queueState` message ({ items: Array<{ id, preview, hasImages }> }, preview ~80 chars, stable id per item) and emit it whenever queuedTurns changes: on enqueue (sendMessage entry-guard), on flush (onTurnEnd drain), on cancel, and on Skull/clear. Give each queuedTurns entry a stable id."
    status: pending
  - id: queue-card-component
    content: "Phase A — Build the QueuedPrompt card component inside PromptPane (new component folder + .less). Looks like a user-message bubble with a `queued` badge; one line, ellipsized; renders ONLY while processing===true AND queue non-empty. Positioned in z-space (absolute/overlay) so it pokes up over the chat history bottom edge and does NOT grow the prompt-pane height. Head item + '+N' count badge for multiple."
    status: pending
  - id: queue-cancel
    content: "Phase A — Wire the card's ✕ cancel: webview→extension `{ type: 'cancelQueued', id }` removes that item from queuedTurns and re-emits queueState. Card updates to next head or disappears. (Empty/whitespace prompts never enqueue — match current Send guard.)"
    status: pending
  - id: queue-state-signal
    content: "Phase A — Add webview state (src/webview/state/session.ts or a new queue signal) for the queue items, fed by the queueState listener; PromptPane subscribes. Clears when queueState is empty (covers Skull-clears-queue: card must vanish)."
    status: pending
  - id: onturnend-contract-align
    content: "Cross-cutting — Align the onTurnEnd drain with the shared contract (authoritative copy in history_modal_upgrade.plan.md): order is (1) silent-query guard return, (2) flip processing off, (3) title trigger, (4) deferred set_model, (5) deferred settings restart, (6) drain ONE queued turn. The step-1 awaitingSilentResult guard already shipped; this todo just verifies the drain stays at step 6 and re-emits queueState after draining."
    status: pending
  - id: sendnow-interrupt
    content: "Phase B — Wire the card's Send now (▸): webview→extension `{ type: 'sendNow' }` → interrupt the active turn via the verified warm stopProcess()/interrupt (process stays alive) and run the head queued item immediately as the next turn. Plain Send-while-busy STILL only queues (resolved: interrupt is explicit-only, never automatic)."
    status: pending
  - id: double-exec-guard
    content: "Phase B — Prevent the Cursor double-execution bug: Send now interrupts → produces a result → onTurnEnd ALSO drains. The same head item must not run twice. Rule: Send now dequeues + runs the head ITSELF, and marks a 'manual flush in progress' (or guards by item id) so the interrupt-triggered onTurnEnd skips one drain. Live-verify no item runs twice."
    status: pending
  - id: askuserquestion-guard
    content: "Phase C — Block-with-hint for the pending-question trap (resolved option A): while an AskUserQuestion / tool-permission request is pending (turn can't end on its own), Send does NOT silently queue — the prompt box shows 'answer the question above first' and routes focus to the question card. Requires the webview to know a question is pending (pendingQuestions signal) and the Send handler to short-circuit."
    status: pending
  - id: edge-cases-pass
    content: "Cross-cutting — Handle the spec's edge cases: turn ends naturally while card shows (head flushes, card updates/disappears); cancel last item (card disappears); Skull clears queue (card clears via queueState); queued prompt with images (preview indicates attachment, queuedTurns already carries images); question answered while a prompt is queued behind it (if allowed)."
    status: pending
  - id: version-bump
    content: "Bump appcloud9.X in package.json before packaging."
    status: pending
  - id: build-install
    content: "npm run compile, package the VSIX with vsce --no-dependencies, install with cursor --install-extension --force. Confirm the installed version matches the built version before reload."
    status: pending
  - id: verify
    content: "Verify in-app after reload: sending while busy shows the peeking card (no vanishing); cancel removes it; Send now interrupts the live turn and runs the queued prompt next with NO double-execution (check process pid stays alive — warm interrupt — and the item runs exactly once); pending-question case blocks Send with the hint instead of trapping; card never grows the prompt-pane height; multi-item shows head + '+N'. Confirm a queued title silent-query is NOT mistaken for a queued user prompt (onTurnEnd guard)."
    status: pending
isProject: false
---

# Prompt Queue UX — visible queued prompts + deliberate interrupt

## Background

When you send a prompt while a turn is in flight, the extension **silently
queues it** (`subprocess.ts` → `⏸️ turn queued`, the `queuedTurns` array) and
flushes it at the next turn boundary (`onTurnEnd`). The machinery is correct,
but there is **no UI**: the prompt box clears and nothing indicates anything is
pending. Two observed failures:

1. **Invisible queue** — a user sent two prompts during an active turn
   (`queueLen=2`); the UI showed nothing, so they appeared to vanish.
2. **The AskUserQuestion trap** — while a question (a `can_use_tool` control
   request) is pending, the turn **never ends**, so anything queued behind it
   can never flush until the question is answered. Queued prompts pile up
   invisibly and then all fire back-to-back on answering.

The target is the **Cursor behavior**: sending while busy shows a compact
"peeking" queued card with its own send button; an explicit action interrupts
the current turn and sends the queued prompt now.

Full spec: [doc/prompt_queue_ux_spec.md](prompt_queue_ux_spec.md).

## Approach

A **visibility + interrupt-routing layer** on top of the existing `queuedTurns`
+ warm-`interrupt` machinery. `queuedTurns` in `subprocess.ts` stays the single
source of truth; the extension emits its state to the webview, which renders a
`QueuedPrompt` card inside the `PromptPane`. Interrupt is **explicit-only** (the
card's **Send now**), never automatic — matching Cursor's safe default and
avoiding their unexpected-interrupt regressions.

Phasing mirrors the spec, smallest-risk first:

- **Phase A — visibility.** Emit `queueState`, render the peeking card, support
  cancel. Fixes "vanished into the ether" with zero interrupt risk.
- **Phase B — send-now / interrupt.** Card's **Send now** → warm interrupt +
  immediate flush, with a hard guard against double-execution.
- **Phase C — AskUserQuestion guard.** Block-with-hint so prompts can't be
  trapped behind a pending question.
- **Phase D (optional, later).** Edit queued text, multi-item reorderable list.

## Files to modify

- [src/subprocess.ts](../src/subprocess.ts) — give `queuedTurns` entries a stable
  `id`; emit `queueState` on enqueue / drain / cancel / clear; add the `sendNow`
  interrupt+flush path and the double-execution guard; keep the drain at step 6
  of the shared `onTurnEnd` contract.
- [src/webview.ts](../src/webview.ts) — route the new messages (`queueState` out;
  `sendNow`, `cancelQueued`, optional `editQueued` in).
- [src/webview/vscode.ts](../src/webview/vscode.ts) — add the new
  `MessageToExtension` / `MessageFromExtension` union members.
- [src/webview/state/session.ts](../src/webview/state/session.ts) — a queue
  signal fed by the `queueState` listener (registered at module level).
- `src/webview/components/QueuedPrompt/` — NEW component folder
  (`QueuedPrompt.tsx` + `QueuedPrompt.less`), rendered inside `PromptPane`.
- `src/webview/components/PromptPane/` — mount the card; the Send handler learns
  the pending-question short-circuit (Phase C).
- [package.json](../package.json) — bump `appcloud9.X`.

## Implementation details

### Phase A — visibility

- **Stable ids:** when pushing to `queuedTurns`, attach an `id` (e.g. a
  monotonic counter or timestamp-based key passed in via args, since
  `Math.random`/`Date.now` constraints apply to workflow scripts, not extension
  code — extension code may use them freely). The `id` targets cancel.
- **`queueState` emit:** a single helper `emitQueueState()` that posts
  `{ type: 'queueState', data: { items: queuedTurns.map(t => ({ id, preview: t.message.slice(0,80), hasImages: !!t.images?.length })) } }`.
  Call it at every `queuedTurns` mutation: enqueue, drain (`onTurnEnd`), cancel,
  and the Skull/clear paths that already do `queuedTurns = []`.
- **Card:** a user-bubble-styled component with a `queued` pill badge; single
  line + `text-overflow: ellipsis`; positioned `absolute`/overlay so it pokes
  up over the chat-history bottom edge and does **not** add prompt-pane height.
  Renders only while `processing === true` and the queue is non-empty. Head item
  + `+N` badge for multiples. All colors via `--vscode-*`.

### Phase B — send-now / interrupt

- **`sendNow`:** interrupt the live turn via the verified warm `stopProcess()`
  (interrupt control request — process stays alive), then run the head queued
  item as the next turn.
- **Double-execution guard (the Cursor bug to avoid):** Send now interrupts →
  yields a `result` → `onTurnEnd` would ALSO drain. The same head must not run
  twice. Rule: **Send now dequeues + runs the head itself** and sets a
  "manual flush in progress" marker (or guards by item `id`) so the
  interrupt-triggered `onTurnEnd` **skips one drain**. Live-verify exactly-once.

### Phase C — AskUserQuestion guard (block-with-hint, resolved)

- While an AskUserQuestion / tool-permission request is pending, **Send does not
  queue**. The prompt box shows "answer the question above first" and routes
  focus to the question card. The webview already has a `pendingQuestions`
  signal (from the AskUserQuestion work); the Send handler short-circuits on it.

### The shared `onTurnEnd` contract

Authoritative copy lives in `history_modal_upgrade.plan.md`. Order for a real
user-turn `result`:

1. **Guard** — if `awaitingSilentResult` (a silent-query/title completion), do
   nothing else and return. (Already shipped.)
2. `isProcessing = false`; disarm watchdog; post `setProcessing:false`.
3. Title trigger (history plan) — issues a silent query, non-blocking.
4. Deferred `set_model`.
5. Deferred settings restart.
6. **Drain one queued turn** (this feature) — shift + run head of `queuedTurns`,
   then `emitQueueState()`.

The step-1 guard is what stops a title query from silently flushing a queued
prompt. This plan only adds the `emitQueueState()` after the drain and the
double-exec coordination with `sendNow`.

## Edge cases

- **Double-execution:** Send now + onTurnEnd must not both run the head — guard
  by id / manual-flush marker. Verify exactly-once.
- **Multiple items + Send now:** flush the head (FIFO), interrupting; remaining
  items stay queued, card updates to next head + `+N`.
- **Turn ends naturally while card shows:** head flushes via `onTurnEnd`; card
  updates or disappears.
- **Cancel last item:** card disappears; nothing else changes.
- **Skull while items queued:** `queuedTurns` cleared (existing) — card must
  clear too (driven off `queueState`).
- **Empty/whitespace prompt:** don't enqueue (match current Send guard).
- **Queued prompt with images:** `queuedTurns` already carries `images`; preview
  flags an attachment.
- **Pending question + Send now (Phase C+):** interrupt may not yield a clean
  `result` while a `can_use_tool` is outstanding — "send now" there must
  hard-cancel the question turn. Needs a live test before building beyond
  block-with-hint.

## What we are NOT doing

- Not changing the CLI control protocol or the `can_use_tool` wire name — only
  how we present/guard it.
- Not building a multi-item reorderable queue editor in v1 (head + `+N` only;
  reorder is Phase D).
- Not changing the single-process / single-writer / identity-guard /
  cross-window-lock invariants — purely a queue-visibility + interrupt-routing
  layer.
- Not implementing live in-flight steering ("consider this alongside what you're
  doing") — that's `/btw`-style, deliberately out of scope.
- Not making plain Send ambiguous — Send-while-busy ALWAYS queues; only the
  card's Send now interrupts.

## Open questions

- **AskUserQuestion "send now":** if we later let a queued item override a
  pending question, "send now" must hard-cancel the question turn — needs a live
  test (interrupt may not produce a clean `result` while `can_use_tool` is
  outstanding).
- **Second-Send-to-interrupt:** the spec resolved interrupt to the card button
  as canonical; a deliberate double-Send MAY be added later as an accelerator,
  but plain Send must stay unambiguous (queue-only).
- **Internal naming of `can_use_tool`:** cosmetic — whether to classify it as
  `interactivePrompt` vs `toolPermission` in our own logs/messages. Low priority.

---
name: Fix cost double-counting (cumulative total_cost_usd added as per-turn delta)
overview: >
  The status-bar cost is grossly inflated (~$418 for work that should cost ~$80)
  because the CLI's `total_cost_usd` is CUMULATIVE per warm process, but the
  extension adds the whole cumulative value to its own running total every turn —
  compounding the cost quadratically. Fix: track the last-seen cumulative per
  process and add only the delta, resetting the baseline on every respawn.
todos:
  - id: confirm-cumulative-semantics
    content: "VERIFY FIRST (read-only): confirm total_cost_usd is cumulative-per-warm-process, not per-turn, by reading raw `result` events in the logs — within one pid the value should monotonically increase; on respawn it restarts low. (Already strongly evidenced by the addTokens sawtooth resetting at each spawn.) Also check num_turns / duration_ms for the same cumulative semantics since they're displayed too."
    status: pending
  - id: delta-accounting
    content: "In subprocess.ts result handler, stop adding the raw total_cost_usd. Track lastProcessCumulativeCost (per warm process); add (total_cost_usd - lastProcessCumulativeCost) clamped to >= 0, then set lastProcessCumulativeCost = total_cost_usd."
    status: pending
  - id: reset-baseline-on-spawn
    content: "Reset lastProcessCumulativeCost = 0 on every spawnProcess (new + respawn) so the first turn of a fresh process adds its full cumulative (which starts from 0 for that process), not a delta against a stale prior-process baseline."
    status: pending
  - id: audit-token-counts
    content: "Audit whether input/output token totals have the SAME bug. They come from message.usage (per-assistant-message, likely already per-turn) not from the cumulative result — confirm they are NOT cumulative and need no delta treatment. Document the finding; only change if also cumulative."
    status: pending
  - id: recompute-or-annotate-existing
    content: "Decide handling for already-saved inflated totals in existing conversations: the stored totalCost in past conversation files is wrong. Either leave as-is (new turns won't compound further once fixed, but the historical inflation remains) or zero/recompute on load. Pick the least-surprising option and note it."
    status: pending
  - id: verify-live
    content: "After the fix: run several turns, grep the logs, and confirm per-turn added cost matches the CLI's per-turn delta (total_cost_usd[n] - total_cost_usd[n-1]) and that a respawn mid-conversation doesn't reset or double-count. Sanity-check the day total lands in the plausible (~$80-ish) range, not 4-5x."
    status: pending
  - id: version-bump
    content: "Bump appcloud9.X to the next version in package.json before packaging."
    status: pending
isProject: false
---

# Fix cost double-counting (cumulative `total_cost_usd` added as per-turn delta)

## Where the dollar figure comes from (provenance — important context)

**The extension does NO pricing math of its own.** Confirmed by grep: there is no
rate table, no per-token price constant, no `$/1M` multiplication anywhere in
`src/`. The ONLY dollar value in the system is the single field
`jsonData.total_cost_usd` that the `claude` CLI includes on each `result` event.
We are a **pure relay**: we receive a number labeled USD and accumulate it
([src/tokenCounters.ts](../src/tokenCounters.ts) just does `totalCost += cost`).

The CLI computes that figure itself from token usage × the model's price table
(input / output / cache-read / cache-write rates), which lives inside the CLI, not
here. Two consequences worth recording so nobody later mistakes this number for a
billing-grade invoice:

1. **It's the CLI's modeled estimate, not our calculation.** We cannot
   independently re-derive or sanity-check it without a price table we don't have
   (and deliberately don't want to maintain — it would drift from the CLI's).
2. **On Bedrock (this user: `CLAUDE_CODE_USE_BEDROCK=1`), `total_cost_usd` is the
   CLI's estimate against its own price assumptions — NOT necessarily the user's
   actual AWS/Bedrock invoice.** Negotiated/contract Bedrock rates can differ from
   the CLI's list-price model. So even after this fix, the status-bar figure is a
   good *estimate* of spend, not a guaranteed match to the AWS bill.

So "make the number real" has two layers: **(a)** stop our accumulation from
compounding the CLI's value — fully in our control, and the subject of this plan;
**(b)** the CLI's per-turn `total_cost_usd` is itself an estimate we inherit (and
on Bedrock may track list price, not actual). We can make (a) exactly correct; (b)
is an upstream estimate we relay and label as such.

## Background

The status bar reports a per-conversation running cost. For the active
conversation it shows **~$418** — but a comparably heavy full day on Cursor +
Claude 4.7 with the user's own API key costs **~$80–90**. A 4–5× overstatement.

### Root cause (confirmed against the logs)

The CLI emits `total_cost_usd` on each `result` event. **That value is cumulative
for the life of the warm `claude` process, not the cost of the single turn.** The
extension treats it as a per-turn increment:

```ts
// src/subprocess.ts, result handler (~1572)
if (jsonData.total_cost_usd) {
  tokenCounters.addTokens(0, 0, jsonData.total_cost_usd);   // adds the WHOLE cumulative every turn
}
```

`addTokens` just does `totalCost += cost` ([src/tokenCounters.ts](../src/tokenCounters.ts)).
So each turn adds the *running cumulative*, which compounds:

| Turn | CLI `total_cost_usd` (cumulative) | True turn cost | What we add | Our running total | Real total |
|---|---|---|---|---|---|
| 1 | $3 | $3 | $3 | $3 | $3 |
| 2 | $7 | $4 | **$7** | $10 | $7 |
| 3 | $12 | $5 | **$12** | $22 | $12 |
| 4 | $18 | $6 | **$18** | $40 | $18 |

The error grows quadratically — exactly why a real ~$80 day shows as ~$418.

### Evidence (from the 2026-06-06 logs)

Interleaving `addTokens cost=…` with `spawned pid=…` shows a **sawtooth that
resets at every process spawn** — the fingerprint of a per-process cumulative:

```
pid=68481:  3.25 → 3.72 → 7.52 → 7.88 → 16.38 → 16.96 → 20.01
pid=96428 spawns → resets to 4.20 → 6.78 → 10.71 → 15.32
pid=15874 spawns → resets to 3.43 → 4.58 → 5.20 → 5.50 → 7.85
pid=54287:  9.43 → 24.58 → 25.98
pid=61672 spawns → resets to 1.39 → 2.47
```

Within a process the "per-turn cost" only ever **rises** (because it's the running
cumulative); a fresh process **restarts low**. A genuine per-turn cost would
fluctuate up and down with turn size, not monotonically climb then reset on spawn.

### Why the respawn detail matters for the fix

This extension **respawns the warm process mid-conversation** — on model switch,
thinking-pref change, plan-mode toggle, and now the auto-continue `--resume`. Each
respawn restarts the CLI's `total_cost_usd` at ~0 for the new process. So the fix
can't just "use the last value" globally — it must track the cumulative **per
process** and reset the baseline on every spawn, or the first post-respawn turn
would compute a huge negative delta (clamped to 0, silently losing that turn's
cost) or a wrong one.

## Approach

Switch from "add the cumulative" to "add the **delta** since the last `result` on
**this** process":

1. Keep a module-level `lastProcessCumulativeCost` (USD).
2. On each `result`: `delta = max(0, total_cost_usd - lastProcessCumulativeCost)`;
   `tokenCounters.addTokens(0, 0, delta)`; then `lastProcessCumulativeCost = total_cost_usd`.
3. On **every** `spawnProcess` (new and respawn): reset `lastProcessCumulativeCost = 0`,
   because the new process's `total_cost_usd` starts fresh from 0. The first
   `result` on the new process then contributes its full (small) cumulative as the
   delta against 0 — correct.

The `max(0, …)` clamp guards against any out-of-order/duplicate `result` (and against
a missed spawn-reset, where it would under- rather than over-count — the safe
direction).

This keeps `tokenCounters` (the accumulator) and the persistence/restore path
unchanged — we only fix *what number* gets added each turn.

## Files to modify

- [src/subprocess.ts](../src/subprocess.ts) —
  - **Add state** near the other warm-process module vars: `let lastProcessCumulativeCost = 0;`
  - **Result handler (~1572):** replace
    `tokenCounters.addTokens(0, 0, jsonData.total_cost_usd)` with the delta logic
    above. The `currentCost: jsonData.total_cost_usd` field sent in `updateTotals`
    (~1596) is ALSO wrong (it's cumulative, labeled "current") — set it to the delta
    too so any "this turn cost" UI is correct.
  - **`spawnProcess` (~427):** reset `lastProcessCumulativeCost = 0` alongside the
    other per-spawn resets (where `authErrorFired`, `rawOutput`, etc. are reset).
  - **Sanity for `num_turns`/`duration_ms`:** these ride along in `updateTotals`
    (~1597–1598). Confirm whether `num_turns` is also cumulative-per-process and, if
    a "turns this conversation" count is shown, whether it needs the same delta
    treatment. (Out of scope to fix unless displayed wrong — flag in audit todo.)
- [src/tokenCounters.ts](../src/tokenCounters.ts) — likely **no change**; it stays a
  dumb accumulator. (Optional: a clarifying comment that callers must pass per-turn
  deltas, not cumulative values.)
- [package.json](../package.json) — bump `appcloud9.X`.

## Implementation details

```ts
// module scope, near rawOutput/authErrorFired:
let lastProcessCumulativeCost = 0;  // CLI total_cost_usd is cumulative PER PROCESS

// in spawnProcess(), with the other per-spawn resets:
lastProcessCumulativeCost = 0;

// in the result handler, replacing the current addTokens(0,0,total_cost_usd):
if (typeof jsonData.total_cost_usd === 'number') {
  const cumulative = jsonData.total_cost_usd;
  const delta = Math.max(0, cumulative - lastProcessCumulativeCost);
  lastProcessCumulativeCost = cumulative;
  tokenCounters.addTokens(0, 0, delta);
  // and below, send the delta (not the cumulative) as this-turn cost:
  // currentCost: delta
}
```

## Edge cases

- **Mid-conversation respawn** (model switch / thinking change / auto-continue):
  `lastProcessCumulativeCost` resets to 0 on spawn; the next `result`'s full small
  cumulative is added as delta-from-0. Correct, no double count, no loss.
- **Out-of-order or duplicate `result`** (e.g. the interrupt/forced-turn-end paths,
  or the silent title query's own result): `max(0, …)` prevents a negative add. A
  duplicate result with the same cumulative adds 0. Good.
- **Silent queries** (title generation) produce their own `result` with a
  `total_cost_usd` — they DO cost real money and SHOULD be counted. Since they run
  on the same warm process, the cumulative naturally includes them; the delta picks
  them up correctly. Confirm the `awaitingSilentResult` guard returns *before* or
  *after* the cost accounting — cost must be tallied even for silent queries.
  (Check onTurnEnd ordering vs. the result-case cost code — they're in different
  places: cost is in the result stream-case ~1572, the guard is in onTurnEnd. So
  cost is counted regardless. Verify.)
- **First turn ever on a fresh process**: baseline 0, cumulative = that turn's cost,
  delta = full cost. Correct.
- **`total_cost_usd` absent** (some result subtypes): skip (no add), don't touch the
  baseline. Matches current `if (…total_cost_usd)` guard intent.

## What we are NOT doing

- **Not changing `tokenCounters`'s accumulator model** — it stays additive; we fix
  the inputs.
- **Not retroactively fixing the displayed total of the CURRENT live conversation**
  beyond stopping further compounding — unless `recompute-or-annotate-existing`
  decides to. (The number is already inflated in memory; a reload from the saved
  file would show the inflated saved value too.) Decide explicitly.
- **Not adding a daily/lifetime cost tracker** — separate feature; this is purely a
  correctness fix for the existing per-conversation number.
- **Not touching token (input/output) totals** unless the audit finds they're also
  cumulative (they come from `message.usage` per assistant message, so likely already
  per-turn — but verify).

## Open questions

- **Existing saved conversations** carry inflated `totalCost`. Options: (a) leave
  them (historical, cosmetic); (b) on load, if it looks inflated, can't truly
  recompute without the per-turn history (we only saved the total). Likely (a) —
  accept that pre-fix conversations show inflated totals, new/continued ones are
  correct going forward. Confirm the user is OK with that.
- Should the fix also **recompute the current live conversation** from scratch? We
  can't without per-turn deltas we didn't store. Best we can do is stop compounding
  from now on. A `/recount` is not feasible retroactively. Accept.
- Is **`num_turns`** displayed anywhere as a conversation total, and is it also
  cumulative-per-process (same bug class)? Audit confirms scope.

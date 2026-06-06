---
name: Context-window % indicator (authoritative, via get_context_usage)
overview: >
  Show the percentage of the context window used in the status bar, sourced from
  the CLI's own get_context_usage control request — the same data /context uses,
  including the real window size and the auto-compact threshold. Poll it after each
  turn, post it to the webview, render "ctx N%" that color-shifts as it nears the
  auto-compact line, with a "compact soon" hint near the threshold.
todos:
  - id: ground-truth-confirmed
    content: "DONE (probe_context.mjs, since removed): get_context_usage returns { totalTokens, maxTokens, rawMaxTokens, percentage (already computed!), autoCompactThreshold, isAutoCompactEnabled, autocompactSource, categories[] }. Verified on the authenticated Bedrock binary: empty session ~4779/1M = 0%, after a turn 21076/1M = 2%, autoCompactThreshold=967000, isAutoCompactEnabled=true. models[] has NO window field, and assistant.usage cache tokens are erratic on Bedrock — so get_context_usage is the ONLY correct source. No further probing needed."
    status: completed
  - id: send-control-request
    content: "Add a getContextUsage() in subprocess.ts that calls sendControlRequest('get_context_usage') and returns the parsed response. Handle reject/timeout gracefully (degrade: just don't update the indicator)."
    status: pending
  - id: poll-timing
    content: "Call getContextUsage() after each turn's result (in onTurnEnd or right after the result case) and once after the initialize handshake / on session load, since context only changes at turn boundaries. Do NOT poll on a timer."
    status: pending
  - id: post-to-webview
    content: "Add a contextUsage message (ext→webview) carrying { totalTokens, maxTokens, percentage, autoCompactThreshold, isAutoCompactEnabled }. Add the type to MessageFromExtension in vscode.ts and post it after each getContextUsage()."
    status: pending
  - id: webview-state
    content: "Add a contextUsage signal in state (new or on tokenState) populated by an on('contextUsage') handler."
    status: pending
  - id: status-bar-render
    content: "Render 'ctx N%' in SessionStatus displayText (Ready line). Color-shift as it approaches autoCompactThreshold/maxTokens (~96.7%): normal → amber near threshold → red at/over. Show a 'compact soon' hint near the threshold."
    status: pending
  - id: edge-cases
    content: "Handle: no data yet (hide the ctx chip until first response); isAutoCompactEnabled false (show % of window, no compact hint); get_context_usage unsupported/errors on some build (degrade silently, no chip)."
    status: pending
  - id: verify-live
    content: "After install: confirm the status bar shows ctx % matching what /context would report, that it updates each turn, and that the threshold coloring/hint appears as it climbs. (Hard to reach high % naturally; can sanity-check low-end accuracy against a get_context_usage probe value.)"
    status: pending
  - id: version-bump
    content: "Bump appcloud9.X to the next version in package.json before packaging."
    status: pending
isProject: false
---

# Context-window % indicator (authoritative, via `get_context_usage`)

## Background

The status bar should show how much of the context window the conversation has
used — like Cursor's "you're at 80%, maybe compact." The user's bar is: this number
must be **incontrovertible and absolutely correct**, matching what Claude Code's own
`/context` shows.

### Why the naive approach is WRONG (proven)

The tempting cheap path — sum `input + cache_read + cache_creation` from each
assistant `usage` and divide by a hardcoded window — is unreliable on this user's
**Bedrock** setup. A live probe of one turn showed:

```
input_tokens: 1953, cache_creation_input_tokens: 19123, cache_read_input_tokens: 0
```

These swing wildly turn to turn (cache_read was 0 here), and do **not** reliably
equal the true context occupancy. Also, the `initialize` `models[]` entries carry
**no window-size field** (only value/displayName/capability flags), so there's no
authoritative denominator there either. The naive number would flicker and mislead.

### The authoritative source (probed, confirmed)

`get_context_usage` (a WIRE control request in
[doc/ref/control_protocol_surface.md](ref/control_protocol_surface.md)) is exactly
what `/context` uses. A live probe against the authenticated Bedrock binary returned
(real values):

```jsonc
{
  "categories": [
    { "name": "System prompt", "tokens": 2286, "color": "promptBorder" },
    { "name": "Memory files",  "tokens": 897,  "color": "claude" },
    { "name": "Skills",        "tokens": 1588, "color": "warning" },
    { "name": "Messages",      "tokens": 8,    "color": "purple_FOR_SUBAGENTS_ONLY" },
    { "name": "Free space",    "tokens": 995221, "color": "promptBorder" }
  ],
  "totalTokens": 4779,            // live context occupancy
  "maxTokens": 1000000,           // the REAL window for this model
  "rawMaxTokens": 1000000,
  "autocompactSource": "auto",
  "percentage": 0,                // CLI ALREADY COMPUTES the %
  "autoCompactThreshold": 967000, // the actionable "compact soon" line (96.7%)
  "isAutoCompactEnabled": true,
  "gridRows": [ /* the /context square-grid viz; we don't need it */ ]
}
```

After one turn the same call returned `totalTokens: 21076, percentage: 2`. So the
CLI hands us the occupancy, the true window, the **percentage already computed**,
and the **auto-compact threshold** — everything needed, authoritative, self-correct
per model. This is the only source we should use.

## Approach

`get_context_usage` is a **control request** (we ask; it's not a stream event), and
context only changes at turn boundaries. So: **poll it once after each turn's
`result`** (and once after the initialize handshake / on session load), cache the
response, and post a compact slice to the webview. The status bar renders the
percentage with threshold-aware coloring.

Use the CLI's own `percentage` field directly (don't recompute) for the headline
number — it's the incontrovertible value. Keep `totalTokens`/`maxTokens`/
`autoCompactThreshold` for the "compact soon" logic and a tooltip
(e.g. "21,076 / 1,000,000 tokens — auto-compact at 967,000").

## Files to modify

- [src/subprocess.ts](../src/subprocess.ts) —
  - **`getContextUsage()`**: new fn calling `sendControlRequest('get_context_usage')`
    (pattern: same as the existing `set_model`/`initialize` calls, ~307/930). Returns
    the parsed object or null on reject/timeout (degrade silently — the existing
    `sendControlRequest` already rejects on timeout/error, so wrap in try/catch).
  - **Poll after each turn**: in the `result` case (~1581) or `onTurnEnd`, after cost
    accounting, fire-and-forget `void postContextUsage()`. Also call once after
    `performInitialize` succeeds (~865) so the chip is populated before the first turn.
  - **`postContextUsage()`**: await `getContextUsage()`, and if it returned data, post
    a `contextUsage` message with the slice below.
  - Guard: don't let a failed/absent `get_context_usage` (older binary, error) break
    anything — just skip the post.
- [src/webview/vscode.ts](../src/webview/vscode.ts) — add to `MessageFromExtension`:
  `{ type: 'contextUsage'; data: { totalTokens: number; maxTokens: number; percentage: number; autoCompactThreshold: number; isAutoCompactEnabled: boolean } }`.
- [src/webview/state/tokens.ts](../src/webview/state/tokens.ts) — add a `contextUsage`
  signal (or extend `tokenState`) and an `on('contextUsage')` handler to populate it.
  A separate signal is cleaner (different cadence/source than per-turn tokens).
- [src/webview/components/SessionStatus/SessionStatus.tsx](../src/webview/components/SessionStatus/SessionStatus.tsx)
  — in the `displayText` computed (~50–80), append a `ctx N%` segment to the Ready
  line (and optionally the Processing line). Add threshold-aware class/color.
- [src/webview/components/SessionStatus/SessionStatus.less](../src/webview/components/SessionStatus/SessionStatus.less)
  — styles for the ctx chip + the near-threshold (amber) and over-threshold (red)
  states.
- [package.json](../package.json) — bump `appcloud9.X`.

## Implementation details

### Sending the control request (subprocess.ts)

```ts
async function getContextUsage(): Promise<any | null> {
  if (!currentClaudeProcess) return null;
  try {
    return await sendControlRequest('get_context_usage');  // {} payload
  } catch (e) {
    log.debug('Subprocess', 'get_context_usage failed (degrading)', { error: (e as any)?.message }, '📐');
    return null;
  }
}

async function postContextUsage(): Promise<void> {
  const u = await getContextUsage();
  if (!u || typeof u.percentage !== 'number') return;
  deps?.postMessage({
    type: 'contextUsage',
    data: {
      totalTokens: u.totalTokens ?? 0,
      maxTokens: u.maxTokens ?? 0,
      percentage: u.percentage ?? 0,
      autoCompactThreshold: u.autoCompactThreshold ?? 0,
      isAutoCompactEnabled: !!u.isAutoCompactEnabled,
    },
  });
}
```

Call sites: `void postContextUsage()` after the result-case cost block, and after a
successful `performInitialize`.

### Threshold-aware display (SessionStatus)

```ts
// percentage is the CLI's own value (incontrovertible). The "compact soon" signal
// is occupancy vs the auto-compact threshold, NOT vs maxTokens.
const cu = contextUsage.value;
if (cu && cu.maxTokens > 0) {
  const nearCompact = cu.isAutoCompactEnabled && cu.autoCompactThreshold > 0
    && cu.totalTokens >= cu.autoCompactThreshold * 0.9;   // within 10% of the line
  parts.push(`ctx ${cu.percentage}%`);                    // e.g. "ctx 2%"
  // class: nearCompact ? 'ctx--warn' : (cu.percentage >= 100 ? 'ctx--full' : 'ctx')
  // optional: append "compact soon" when nearCompact
}
```

Headline number = the CLI's `percentage` (% of window). The amber "compact soon"
trigger uses `autoCompactThreshold` because that's the line that actually matters
(96.7% of window here) — matching the user's Cursor mental model.

## Edge cases

- **No data yet** (before first response / handshake): hide the ctx chip entirely;
  don't show "ctx 0%" until we have a real reading.
- **`isAutoCompactEnabled: false`**: show the `%` of window but no "compact soon"
  hint (there's no threshold to warn about). Still useful as raw occupancy.
- **`get_context_usage` errors / unsupported** on some build: `postContextUsage`
  no-ops, chip stays hidden. Never breaks the turn.
- **maxTokens varies by model** (1M for opus-4-8[1m], 200k for haiku): handled for
  free — the value comes from the response, recomputed each call, so a mid-session
  model switch self-corrects on the next poll.
- **Stale after model switch**: the post-turn poll refreshes it; acceptable that it
  lags by at most one turn.
- **Cost of polling**: `get_context_usage` is a control round-trip, NO model turn —
  effectively free, no token cost. Safe to call every turn.

## What we are NOT doing

- **Not using `assistant.usage` cache tokens** to estimate context — proven erratic
  on Bedrock; `get_context_usage` is authoritative.
- **Not hardcoding the window size** — comes from the response, self-correcting.
- **Not rendering the full `/context` square-grid viz** (`gridRows`/`categories`) —
  out of scope; just the headline % + threshold awareness. (Could be a future
  hover-panel showing the category breakdown.)
- **Not polling on a timer** — context only changes at turn boundaries; post-turn +
  on-load polling is sufficient and avoids needless control traffic.

## Open questions

- Show the ctx chip on the **Processing** line too (live-ish), or only on **Ready**?
  Leaning: Ready only (it's a between-turns metric; during processing it's stale
  until the turn completes anyway). Confirm.
- Exact "compact soon" copy and at what fraction of the threshold to start warning
  (plan uses 90% of threshold ≈ 87% of window). Tune to taste.
- Tooltip with the `categories[]` breakdown (System prompt / Memory / Skills /
  Messages / Free) — nice-to-have, defer unless wanted now.

---
name: Fix Token Status Bar
overview: >
  The status bar (SessionStatus component) isn't receiving token data because the webview listens for
  a 'tokenTotals' message that nobody sends. The extension host sends 'updateTokens' (per-message usage)
  and 'updateTotals' (end-of-request summary with cost/request count), but the webview ignores both.
todos:
  - id: fix-token-listeners
    content: "Replace the 'tokenTotals' listener in state/tokens.ts with listeners for 'updateTokens' and 'updateTotals' — the actual messages the extension host sends"
    status: pending
  - id: expand-token-state
    content: "Add requestCount and totalCost to the token state signal so SessionStatus can display them"
    status: pending
  - id: update-session-status
    content: "Update SessionStatus computed display to use the new state shape and show request count + cost in Ready state"
    status: pending
  - id: fix-vscode-types
    content: "Update MessageFromExtension to declare updateTokens and updateTotals instead of tokenTotals"
    status: pending
  - id: verify-build
    content: "Build, install, verify token count updates in real-time during processing and shows totals when ready"
    status: pending
isProject: false
---

# Fix Token Status Bar

## Background

The status bar (`SessionStatus` component) is supposed to show token counts during processing and a summary (tokens + requests) when ready. It displays "0 tokens" because the data never arrives.

**Root cause:** A message name mismatch.

The extension host (`subprocess.ts`) sends:
- `updateTokens` — fired on each assistant message with per-turn usage (input/output tokens, cache tokens) plus running totals
- `updateTotals` — fired at end of request with totalCost, totalTokensInput, totalTokensOutput, requestCount

The webview (`state/tokens.ts`) listens for:
- `tokenTotals` — a message that nothing sends

The old build handled both `updateTokens` and `updateTotals` in its script.ts message handler and used them to update the status bar in real time.

## Approach

Fix the webview state to listen to the correct messages. Expand the token state to hold everything the status bar needs (total input/output, request count, cost). The `SessionStatus` component already has the display logic — it just needs real data.

## Files to modify

- [src/webview/state/tokens.ts](src/webview/state/tokens.ts) — replace listener, expand state shape
- [src/webview/components/SessionStatus/SessionStatus.tsx](src/webview/components/SessionStatus/SessionStatus.tsx) — update to use new state shape
- [src/webview/vscode.ts](src/webview/vscode.ts) — fix MessageFromExtension types

## Implementation details

### state/tokens.ts

```ts
export interface TokenState {
  totalInput: number;
  totalOutput: number;
  requestCount: number;
  totalCost: number;
  // Per-message (most recent)
  currentInput: number;
  currentOutput: number;
  cacheCreation: number;
  cacheRead: number;
}

export const tokenState = signal<TokenState>({...zeros});

on('updateTokens', (msg) => {
  // Fired per assistant message with running totals + current breakdown
  tokenState.value = {
    ...tokenState.value,
    totalInput: msg.data.totalTokensInput,
    totalOutput: msg.data.totalTokensOutput,
    currentInput: msg.data.currentInputTokens,
    currentOutput: msg.data.currentOutputTokens,
    cacheCreation: msg.data.cacheCreationTokens,
    cacheRead: msg.data.cacheReadTokens,
  };
});

on('updateTotals', (msg) => {
  // Fired at end of request with cost + request count
  tokenState.value = {
    ...tokenState.value,
    totalInput: msg.data.totalTokensInput,
    totalOutput: msg.data.totalTokensOutput,
    requestCount: msg.data.requestCount,
    totalCost: msg.data.totalCost,
  };
});
```

### SessionStatus changes

- Import new `tokenState` instead of old `tokenTotals`
- `totalTokens` = `tokenState.value.totalInput + tokenState.value.totalOutput`
- Show `requestCount` and optionally `totalCost` in ready state

### vscode.ts type changes

Remove:
```ts
| { type: 'tokenTotals'; data: { input: number; output: number; cacheRead: number; cacheWrite: number } }
```

Add:
```ts
| { type: 'updateTokens'; data: any }
| { type: 'updateTotals'; data: any }
```

## Edge cases

- **First load:** `updateTotals` is sent when a conversation is loaded from history (webview.ts line ~862), so totals restore on reload
- **Zero state:** Display "0 tokens" gracefully when no messages have been sent yet
- **Cost display:** Only show cost if > 0 (API users); plan subscribers won't have cost data

## What we are NOT doing

- **OpenCredits balance display** — stripped from this fork
- **Subscription type detection** — the old build had plan vs API logic; we'll just show tokens + cost for now
- **Per-message token breakdown in chat** — the old build injected a system message with cache stats; we skip that for now (it clutters the chat)

## Open questions

- None — the extension host API is clear and the fix is a straightforward message name correction + state expansion.

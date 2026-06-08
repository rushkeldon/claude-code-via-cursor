---
name: Robust API-error detection, error card, and Respawn recovery
overview: Detect provider API errors (auth/credential expiry, rate-limit, overload, bad-request) on every ingress path — including the assistant-text channel that currently slips through — render them in a categorized error card, and offer a one-click "Respawn" recovery on the composer button instead of forcing a window reload.
todos:
  - id: classifier
    content: "Add classifyApiError() helper + ApiErrorCategory type in subprocess.ts"
    status: pending
  - id: ingress-assistant
    content: "Hook classifier into the assistant-text path (the channel that leaked the 403)"
    status: pending
  - id: ingress-result
    content: "Broaden the result-case auth check to use the classifier (any subtype)"
    status: pending
  - id: ingress-stderr
    content: "Route stderr detection through the same classifier; keep AUTH_PATTERNS as a fallback"
    status: pending
  - id: emit-apierror
    content: "Emit a single apiError message (category + code + detail) and store lastFailedTurn"
    status: pending
  - id: card-generalize
    content: "Generalize AuthErrorCard into ApiErrorCard, labeled/affordanced by category"
    status: pending
  - id: respawn-button
    content: "Add Respawn state to the composer primary button (send / stop+skull / respawn)"
    status: pending
  - id: respawn-handler
    content: "Implement respawnAndResend() in subprocess.ts + 'respawn' message handler in webview.ts"
    status: pending
  - id: fix-openterminal
    content: "Fix the dangling openTerminal message (no handler exists today)"
    status: pending
  - id: protocol
    content: "Add apiError / respawn to the message protocol unions in vscode.ts"
    status: pending
  - id: verify
    content: "Verify: simulate each error class, confirm card + Respawn recovery without reload"
    status: pending
  - id: bbpi
    content: "Bump appcloud9.X to the next version, then build, package, install (BBPI)"
    status: pending
isProject: false
---

# Robust API-error detection, error card, and Respawn recovery

## Background

A live session hit `Failed to authenticate. API Error: 403 The security token included in the request is expired` and it rendered as a normal **CLAUDE** message bubble. The user then had to refresh credentials *outside* the extension and **reload the VS Code window** before they could get a working session again.

The logs tell the real story, and it differs from how the current code expected to catch this:

- The error text **never appeared on stderr** and was **never logged as an `authError`** — the stderr-based `AUTH_PATTERNS` matcher (`src/subprocess.ts:638`) never had a chance to fire.
- At `23:39:59` and `23:45:20` the stream emitted `result subtype="error_during_execution"`, and the error text arrived as an **`assistant` text block on stdout** — saved as `messageType: "output"` (confirmed in the stored conversation, idx 7). That path (`src/subprocess.ts:1347`) emits `type: 'output'` with **no inspection**, so it renders as a CLAUDE bubble.
- The `result`-case auth check (`src/subprocess.ts:1510-1519`) only runs when `subtype === 'success'` and only matches `Invalid API key / Not logged in / /login / not authenticated` — none of which match a Bedrock `403 … security token … expired`.

Credentials are owned by the **Claude Code subprocess, not the extension**: env is `...process.env` (`src/subprocess.ts:520`) and the provider layer (AWS SDK for Bedrock, or the Anthropic OAuth token for a personal account) resolves *fresh on each spawn*. That is why a window reload "fixed" it — reload forced a respawn. A plain respawn is sufficient and **provider-agnostic**: a fresh `claude` child re-reads whatever auth applies, whether that is `~/.aws/credentials` or an Anthropic OAuth token. We never need to know which.

## Design decisions (settled with the user)

1. **Provider-agnostic, by construction.** We never inspect or refresh credentials ourselves. Recovery is always "respawn the subprocess and re-send the failed turn." This covers Bedrock *and* direct-Anthropic accounts with one mechanism.

2. **Detection rule = keyword adjacency, not bare codes.** A coding assistant constantly *talks about* errors and HTTP codes ("a 403 means…", "we retry on 500s"), and this very planning conversation is full of "API Error: 403". A rule of *"error" somewhere AND a 4xx/5xx somewhere* would paint the assistant's own explanations red. So we require the keyword and the code to be **adjacent**, exactly as the CLI emits them:

   ```
   /error[:\s\-]*\b(4\d\d|5\d\d)\b/i
   ```

   - ✅ `Failed to authenticate. API Error: 403 …`, `API Error: 401 {…}`, `Error: 529 Overloaded`
   - ❌ `a 403 is an authorization error and you should…` (model explaining)
   - ❌ `we log the error and retry on 500s` (prose)

   On the **assistant-text channel specifically**, additionally require the match to be the **dominant content of the turn** (short message; the turn produced no tool_use) — a genuine provider failure is the entire failed turn, never a sentence inside a long answer. The `stderr` and `result` channels do not need this guard (prose never flows through them).

3. **Categorize by code → choose affordance.** One detector, one card, label/affordance varies:

   | Code | Category | Card title | Offers Respawn? |
   |---|---|---|---|
   | 401, 403 | `auth` | "Authentication expired" | yes |
   | 429 | `rate-limit` | "Rate limited" | yes (manual only) |
   | 400 | `bad-request` | "Request rejected" | no |
   | 500, 503, 529, other 5xx | `server` | "Service unavailable" | yes |
   | other 4xx | `client` | "Request error" | yes |

4. **Recovery = the composer's primary button becomes "Respawn."** The button is already a state machine — **Send** (idle) / **Stop+Skull** (processing). After a leaf error the subprocess is already dead and parked, so Stop/Skull are no-ops there. We add a third state, **Respawn**, that respawns and re-sends the failed turn. This is strictly better than "skull then re-type," and replaces the "Reload Window" affordance.

5. **No auto-retry.** For `429`, an immediate retry makes it worse; for `auth`, it just fails again until the user has refreshed credentials externally. Respawn is always **manual**.

6. **Neutral copy — drop the `claude login` assumption.** The current card hard-codes `claude login`, which is wrong for a Bedrock account (where the fix is `aws sso login` / new keys). New copy: *"Your credentials appear to be expired or invalid. Refresh your authentication in a terminal, then click Respawn."*

## Files to modify

- [src/subprocess.ts](src/subprocess.ts) — add `classifyApiError()`; hook it into the three ingress paths; emit a unified `apiError` message; store `lastFailedTurn`; add `respawnAndResend()`.
- [src/webview/vscode.ts](src/webview/vscode.ts) — add `apiError` to `MessageFromExtension`; add `respawn` to `MessageToExtension`.
- [src/webview.ts](src/webview.ts) — handle `respawn`; fix the dangling `openTerminal` case.
- [src/webview/components/AuthErrorCard/AuthErrorCard.tsx](src/webview/components/AuthErrorCard/AuthErrorCard.tsx) — generalize into a categorized API-error card (rename to `ApiErrorCard`, or keep filename and widen behavior — see Edge cases).
- [src/webview/components/AuthErrorCard/AuthErrorCard.less](src/webview/components/AuthErrorCard/AuthErrorCard.less) — category-variant styling.
- [src/webview/components/PromptPane/PromptPane.tsx](src/webview/components/PromptPane/PromptPane.tsx) — add the Respawn button state.
- [src/webview/state/session.ts](src/webview/state/session.ts) — add a `respawnAvailable` signal; clear it when a turn starts.
- [package.json](package.json) — version bump (the **next** `appcloud9.X`).

## Implementation details

### 1. The classifier (single source of truth) — `src/subprocess.ts`

```ts
export type ApiErrorCategory = 'auth' | 'rate-limit' | 'bad-request' | 'server' | 'client';

interface ApiErrorClassification {
  isError: boolean;
  code?: number;
  category?: ApiErrorCategory;
}

// keyword "error" must be ADJACENT to a 4xx/5xx code (see plan §2).
const API_ERROR_RE = /error[:\s\-]*\b(4\d\d|5\d\d)\b/i;

export function classifyApiError(text: string): ApiErrorClassification {
  if (!text) { return { isError: false }; }
  const m = API_ERROR_RE.exec(text);
  if (!m) { return { isError: false }; }
  const code = parseInt(m[1], 10);
  let category: ApiErrorCategory;
  if (code === 401 || code === 403) { category = 'auth'; }
  else if (code === 429) { category = 'rate-limit'; }
  else if (code === 400) { category = 'bad-request'; }
  else if (code >= 500) { category = 'server'; }
  else { category = 'client'; }
  return { isError: true, code, category };
}
```

### 2. Ingress hook A — assistant text (THE leak) — `src/subprocess.ts:1347`

Before emitting `type: 'output'`, classify. Require dominant-content on this channel only:

```ts
if (content.type === 'text' && content.text.trim()) {
  if (silentQueryCallback) { /* unchanged */ }

  const text = content.text.trim();
  const cls = classifyApiError(text);
  // Dominant-content guard: a real provider error is the whole short turn,
  // not a sentence inside a long answer, and never co-occurs with tool_use.
  const turnHadToolUse = jsonData.message.content.some((c: any) => c.type === 'tool_use');
  if (cls.isError && !turnHadToolUse && text.length <= 600) {
    fireApiError(cls, text);
    continue;
  }

  conversation.sendAndSaveMessage({ type: 'output', data: text });
}
```

### 3. Ingress hook B — result case — `src/subprocess.ts:1503-1519`

Replace the narrow `subtype === 'success'` + four-string check with the classifier, applied to any result that carries a message/result string (covers `error_during_execution` and `is_error` successes):

```ts
case 'result': {
  if (jsonData.subtype !== 'success' || jsonData.is_error) {
    turnHealth.signal('error');
  }
  const resultText = typeof jsonData.result === 'string' ? jsonData.result : '';
  const cls = classifyApiError(resultText);
  if (cls.isError) { fireApiError(cls, resultText); return; }
  // ... existing success bookkeeping unchanged ...
}
```

(Keep the legacy login-string check as an OR fallback so `Not logged in` with no HTTP code is still caught → classify as `auth`.)

### 4. Ingress hook C — stderr — `src/subprocess.ts:638`

```ts
proc.stderr.on('data', (data) => {
  const chunk = data.toString();
  errorOutput += chunk;
  const cls = classifyApiError(chunk);
  if (cls.isError) { fireApiError(cls, chunk); return; }
  // keep AUTH_PATTERNS as fallback for code-less auth phrases
  if (!apiErrorFired && AUTH_PATTERNS.some(p => p.test(chunk))) {
    fireApiError({ isError: true, category: 'auth' }, chunk);
  }
});
```

### 5. `fireApiError()` — unify, store the failed turn, replace `fireAuthError`

```ts
let lastFailedTurn: Turn | undefined;

const fireApiError = (cls: ApiErrorClassification, rawSnippet: string) => {
  if (apiErrorFired) { return; }
  apiErrorFired = true;
  log.warn('ApiError', 'apiError fired', { category: cls.category, code: cls.code, rawSnippet: rawSnippet.trim() }, '🔐');
  lastFailedTurn = currentTurn;          // capture what to resend (set in runTurn)
  deps!.postMessage({
    type: 'apiError',
    data: { category: cls.category, code: cls.code, detail: rawSnippet.trim().slice(0, 800) }
  });
  try { proc.kill('SIGTERM'); } catch { /* already dead */ }
};
```

- Rename the existing `authErrorFired` flag → `apiErrorFired`; the close handler's early-return block (`src/subprocess.ts:666-676`) keys off it unchanged.
- `runTurn()` must stash `currentTurn = turn` so `lastFailedTurn` is accurate.

### 6. `respawnAndResend()` — `src/subprocess.ts`

```ts
export async function respawnAndResend(): Promise<void> {
  if (!deps) { return; }
  const turn = lastFailedTurn;
  apiErrorFired = false;          // clear the latch
  await killProcess();            // safe even if already dead; resets reuse state
  if (turn) { await sendMessage(turn.message, turn.planMode, turn.images); }
}
```

`killProcess()` (`src/subprocess.ts:1651`) already tears down reuse state and is identity-guarded; `sendMessage()` (`:304`) will spawn fresh (re-reading creds) and run the turn.

### 7. Protocol — `src/webview/vscode.ts`

```ts
// MessageFromExtension
| { type: 'apiError'; data: { category: 'auth'|'rate-limit'|'bad-request'|'server'|'client'; code?: number; detail?: string } }
// MessageToExtension
| { type: 'respawn' }
```

Keep `authError` temporarily for back-compat, or migrate the card fully to `apiError` (preferred — single path).

### 8. Webview host — `src/webview.ts`

```ts
case 'respawn':
  await subprocess.respawnAndResend();
  return;
case 'openTerminal':            // currently dangling — no handler exists
  await subprocess.launchColdTerminal?.();   // or terminalCommands.openTerminal()
  return;
```

### 9. Composer button — `src/webview/state/session.ts` + `PromptPane.tsx`

`session.ts`:

```ts
export const respawnAvailable = signal(false);
on('apiError' as any, (m: any) => { respawnAvailable.value = m.data?.category !== 'bad-request'; });
on('setProcessing', (msg) => {
  processing.value = !!msg.data?.isProcessing;
  if (msg.data?.isProcessing) { sessionParked.value = false; respawnAvailable.value = false; }
});
```

`PromptPane.tsx` (around the existing `!isProcessing ? send : stop+skull` block, `:655`):

```tsx
{respawnAvailable.value ? (
  <button class="respawn-btn" type="button" onClick={() => post({ type: 'respawn' } as any)}>
    respawn
  </button>
) : !isProcessing ? (
  <button class="send-btn" ...>send</button>
) : (
  /* stop + skull group, unchanged */
)}
```

### 10. The card — generalize `AuthErrorCard`

Drive title/body/affordance off `data.category`; render the raw provider message under a `<details>`; the primary recovery action is now **Respawn** (`post({ type: 'respawn' })`) plus a neutral **Open Terminal** (so the user can run `aws sso login` / `claude login` / whatever applies). Remove the `claude login` hard-coded copy and the "Reload Window" button.

## Edge cases

- **False positive from prose:** mitigated by keyword-adjacency regex + dominant-content guard on the assistant channel. The bad-request category never offers Respawn (resending an over-long-context turn would just fail again).
- **Repeated failure:** `apiErrorFired` latches once per process; `respawnAndResend()` clears it. If the respawned turn fails again, a fresh card appears — no infinite loop, no auto-retry.
- **429 storms:** Respawn is manual; we never auto-fire it, so we don't hammer a rate-limited endpoint.
- **Code-less auth phrases** (`Not logged in`, `please run claude login`): still caught via the retained `AUTH_PATTERNS` / legacy result-string fallback, classified as `auth`.
- **Streaming fragmentation:** the assistant text block is delivered whole at `case 'assistant'` (not split mid-token), so the regex sees the complete message.
- **Card filename:** prefer keeping the `AuthErrorCard/` folder but widening it (less churn), or rename to `ApiErrorCard/`. Either is fine; do not leave two cards both listening.

## What we are NOT doing

- **No credential-file watcher** (e.g. watching `~/.aws/credentials`). It is provider-specific and breaks for keychain-stored OAuth tokens; manual Respawn is the universal answer.
- **No auto-retry / no exponential backoff.** Out of scope and risky for 429.
- **No provider detection.** We deliberately stay agnostic; the subprocess resolves auth itself.
- **No change to the `result` success bookkeeping** (tokens, cost, sessionInfo) beyond gating it behind the new error check.

## Resolved decisions (were open; decided per "follow your instincts")

- **429 affordance → plain Respawn, no countdown.** A countdown needs a `retry-after` value the CLI does not reliably surface, and a wrong countdown is worse than none. The card body for `rate-limit` will simply say *"You've hit a rate limit. Wait a moment, then click Respawn."* — no timer.
- **Cut `authError` over to `apiError` immediately — no deprecated alias.** There are no external consumers of the message protocol (it is internal host↔webview), and `auth` is just one category of the new unified path. Keeping a parallel `authError` message would mean two code paths that can disagree. The `AuthErrorCard` stops listening to `authError` and listens to `apiError` only. (The legacy *stderr `AUTH_PATTERNS`* and the *result login-string* checks are retained — but they now feed `fireApiError({category:'auth'})`, not a separate message.)

## Open questions

None remaining — the two above were resolved by author's judgment. If the user disagrees with either, both are one-line reverts (re-add a countdown branch; re-add an `authError` alias).

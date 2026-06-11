---
name: Faster API-retry / auth-error detection
overview: Detect the CLI's api_retry stream events so a wedged turn (expired credentials, persistent network failure) is surfaced to the user in seconds instead of waiting out the CLI's full ~191s retry ladder. Two complementary changes — fast auth classification from the retry's error_status, and a soft "Claude is retrying…" notice after the 3rd consecutive retry.
todos:
  - id: retry-state
    content: "Add per-process consecutive-api_retry counter + reset points alongside existing process state in subprocess.ts"
    status: pending
  - id: retry-branch
    content: "Add an api_retry branch in processJsonStreamData's system switch: classify error_status (401/403 → fire auth apiError immediately) and count retries"
    status: pending
  - id: retry-notice-msg
    content: "Define a new retrying host→webview message in vscode.ts and post it on the 3rd consecutive retry"
    status: pending
  - id: retry-notice-ui
    content: "Render the transient 'Claude is retrying…' notice in the webview and clear it on next content / turn end / apiError"
    status: pending
  - id: version-bump
    content: "Bump appcloud9.X to the next version in package.json"
    status: pending
  - id: bbpi
    content: "Build, package, install (BBPI) and verify against the logged failure shape"
    status: pending
isProject: false
---

# Faster API-retry / auth-error detection

## Background

When the user's credentials expire (a routine daily occurrence with their
work auth — the token expires overnight), the first turn each morning hangs for
**~191 seconds** before the extension surfaces the failure. Log analysis of the
2026-06-10 incident (pid 15560) established the exact timeline:

```
13:47:34.470  sendMessage                                turn starts
13:47:36.080  system/api_retry  #1   (+1.6s)             FIRST SIGNAL
13:47:36.942  system/api_retry  #2   (+2.5s)
13:47:38.313  system/api_retry  #3   (+3.8s)
   …          7 more retries with exponential backoff …
13:50:45.692  assistant block carrying the 403           +191s
13:50:45.693  🔐 apiError fired category="auth" code=403  ← only NOW surfaced
```

The CLI was silently retrying an expired-token request with exponential
backoff, and CCVC only learned of the failure when the final `result`/assistant
payload arrived ~191s later. The user had already diagnosed it themselves and
opened a terminal to re-auth at 13:48:14 — over two minutes before the extension
said anything.

The fix: **listen to the `api_retry` stream events the CLI already broadcasts.**
The very first one arrives ~1.6s into the turn. This is detection-and-reporting
only — it does **not** touch authentication, credential handling, or request
routing, in keeping with the compliance guardrails in
[CLAUDE.md](../CLAUDE.md). We only read the error *shape* the CLI emits, exactly
as the existing `AUTH_PATTERNS` / `classifyApiError` machinery already does.

### Payload shape (confirmed without reproducing the failure)

The installed `claude` CLI (v2.1.170) is a compiled binary, but its embedded
strings document the event. At the `api_retry` constructor the field cluster is:

```
api_retry
error_status        ← HTTP status code; null for connection errors/timeouts
retry_status
api_error_status
```

and the embedded doc string reads:

> "Emitted when an API request fails with a retryable error and will be retried
> after a delay. `error_status` is null for connection errors (e.g. timeouts)
> that had no HTTP response."

So the event is `{ type: "system", subtype: "api_retry", error_status: <number|null>, … }`.
For an expired token `error_status` is **403**; for a flaky-network stall it is
**null**. This distinction drives the two-path design below.

## Approach

Two complementary detections, both hung off a new `api_retry` branch in the
`system` switch of `processJsonStreamData` in
[src/subprocess.ts](../src/subprocess.ts) (the event currently falls through
that switch unhandled — it's only logged generically at the top of the
function):

1. **Fast auth path (option 2).** On each `api_retry`, if `error_status` is 401
   or 403, immediately call the existing `fireApiError` sink with an `auth`
   classification. This reuses the entire existing recovery flow (the
   `AuthErrorCard`, Respawn, session-park) — we just trigger it ~189s earlier,
   off the first auth-coded retry instead of the final result. `fireApiError`
   already latches (`apiErrorFired`) so it fires exactly once.

2. **General retry notice (option 1).** Maintain a per-process counter of
   *consecutive* `api_retry` events. On the **3rd** consecutive retry, post a new
   transient `retrying` message to the webview, which renders a soft inline
   notice: **"Claude is retrying…"**. This is the catch-all for non-auth
   persistent failures (network stalls, 5xx, timeouts where `error_status` is
   null) — it doesn't kill the process or offer recovery, it just tells the user
   "something's wrong, you're not imagining the wait." The counter resets the
   moment real progress resumes (any non-retry stream event of substance) and on
   turn end, so a single stray retry on an otherwise-healthy turn never trips it.

These compose cleanly: an expired-token turn fires the auth card on retry #1
(path 1) and never reaches the count-of-3 notice; a flaky-network turn shows the
soft notice on retry #3 (path 2) and recovers silently when the network
recovers.

## Files to modify

- [src/subprocess.ts](../src/subprocess.ts) — add the consecutive-retry counter
  to the per-process state block (~line 95, near `apiErrorFired`); add the
  `api_retry` branch to the `system` switch in `processJsonStreamData` (~line
  1383, after the `compact_boundary` branch); reset the counter on turn end
  (`onTurnEnd`) and on spawn (wherever `apiErrorFired` is reset).
- [src/webview/vscode.ts](../src/webview/vscode.ts) — add the `retrying`
  message to the `MessageFromExtension` union (~line 51, beside `apiError`).
- A webview component to render the notice — reuse the `SessionStatus` indicator
  if a status-line treatment fits, or a small dedicated transient banner.
  Decide during implementation (see Open questions).
- [package.json](../package.json) — bump `appcloud9.X` to the **next** version.

## Implementation details

### subprocess.ts — per-process state (~line 95)

```ts
// Counts CONSECUTIVE api_retry stream events on the live process. Reset to 0
// the moment substantive progress resumes and on every turn end / spawn. Used
// to surface a soft "Claude is retrying…" notice once the CLI has clearly
// stalled (3+ back-to-back retries) without waiting out its full retry ladder.
let consecutiveApiRetries = 0;
```

### subprocess.ts — the api_retry branch (in the `system` switch, after `compact_boundary`)

```ts
} else if (jsonData.subtype === 'api_retry') {
    consecutiveApiRetries++;
    // error_status is the HTTP code (null for connection errors/timeouts).
    const status = jsonData.error_status;
    log.debug('StreamParser', 'api_retry',
        { errorStatus: status, consecutive: consecutiveApiRetries }, '🔁');

    // Fast auth path: an auth-coded retry means re-sending will keep failing —
    // surface the auth card now instead of after the full retry ladder. Reuses
    // the existing fireApiError sink (latches once; drives AuthErrorCard +
    // Respawn). We never inspect credentials — only the status code the CLI
    // reports. See doc/network_auth_error_handling.plan.md.
    if (status === 401 || status === 403) {
        fireApiError(
            { isError: true, code: status, category: 'auth' },
            `API retry reported auth error ${status}`,
        );
        break;
    }

    // General backstop: once the CLI has clearly stalled (3 back-to-back
    // retries), tell the user. Non-destructive — no process kill, no recovery
    // offer; the turn may still succeed when the transient cause clears.
    if (consecutiveApiRetries === 3) {
        conversation.sendAndSaveMessage({ type: 'retrying', data: {} });
    }
}
```

Note: emit the notice exactly **once** at the threshold (`=== 3`), not on every
retry past 3, so retries 4..N don't spam. (Alternatively post once and let the
webview ignore duplicates — pick one; `=== 3` is simplest.)

### subprocess.ts — counter resets

- In `onTurnEnd` (turn complete): `consecutiveApiRetries = 0;`
- Wherever a fresh process is spawned / `apiErrorFired` is cleared: reset to 0.
- **Reset on substantive progress within a turn too** — when the stream produces
  real content after some retries (e.g. `message_start`, a `content_block_start`,
  or the first `assistant` content), zero the counter so a later isolated retry
  starts counting fresh. The cleanest hook is the `message_start` /
  `content_block_start` handling already in the `stream_event` case (~line 1295).

### vscode.ts — message type (~line 51)

```ts
| { type: 'retrying'; data: {} }
```

### webview — the notice

Render **"Claude is retrying…"** as a transient, non-blocking notice. It must
clear automatically when:
- the next substantive content arrives (a turn resumed → `setProcessing`/turn
  activity), and
- the turn ends, and
- an `apiError` fires (the auth card supersedes it).

The existing `AuthErrorCard` ([AuthErrorCard.tsx](../src/webview/components/AuthErrorCard/AuthErrorCard.tsx))
is the closest pattern for a signal-driven, auto-clearing banner; the
`SessionStatus` indicator ([SessionStatus.tsx](../src/webview/components/SessionStatus/SessionStatus.tsx))
already folds `turnActivity` + `apiError` into one status and may be the more
natural home (a transient "retrying" status state) than a separate card. Decide
based on which reads less intrusively — the notice should be quiet, not alarming.

## Edge cases

- **Auth retry with `error_status` null:** a connection error (timeout) reports
  null, so it won't hit the fast auth path — it correctly falls to the count-of-3
  notice instead. Only genuine 401/403 HTTP responses trigger the auth card.
- **Single stray retry on a healthy turn:** common and harmless. The counter
  resets on substantive progress and on turn end, so one retry never reaches the
  threshold of 3.
- **Retries continue past 3:** post the notice once (at `=== 3`); do not re-post
  on 4..N.
- **Notice still showing when the turn finally succeeds:** the auto-clear on
  resumed content / turn end removes it; the user sees the retry was transient.
- **fireApiError already latched:** if some other ingress (assistant text,
  result, stderr) fired first, `fireApiError`'s `apiErrorFired` guard makes the
  retry-path call a no-op. No double card.
- **Counter must be per-process, not per-turn-only:** it resets on turn end, but
  it lives in the per-process state block so a respawn starts clean.

## What we are NOT doing

- **No authentication handling.** We never call `claude login`, never inspect or
  store credentials, never re-auth on the user's behalf. We only read the
  `error_status` code the CLI broadcasts and report it. This is the same posture
  as the existing `classifyApiError` / `AUTH_PATTERNS` detection.
- **No change to the retry behavior itself.** The CLI owns retrying; we don't
  cancel, accelerate, or alter its retry ladder — we only observe it.
- **No new recovery action for the soft notice.** The count-of-3 notice is purely
  informational; the auth path reuses the existing Respawn/terminal flow.
- **Not touching the existing late-detection ingresses** (assistant text, result,
  stderr). They stay as a backstop; this just adds an earlier one.

## Open questions

- **Notice home:** dedicated transient banner vs. a new `SessionStatus` state.
  Lean toward whichever is quieter; resolve at implementation time by eyeballing
  both against the prompt pane.
- **Threshold of 3:** matches the user's stated preference ("after the third
  retry"). Confirm it doesn't feel too eager on a merely-slow (but recovering)
  network — the 2026-06-10 retry cadence (#3 at +3.8s) means the notice would
  appear ~4s in, which seems right.

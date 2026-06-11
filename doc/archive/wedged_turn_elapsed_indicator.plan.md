---
name: Honest elapsed indicator (replace the unreliable wedged probe verdict)
overview: Stop trying to DIAGNOSE wedged-vs-slow (proven undecidable) and instead COMMUNICATE like the terminal does — never go silent. Rip out the disproven probe latency-verdict (appcloud9.175) but reuse its connect-window timer to drive an escalating, non-destructive "still waiting / taking a while" indicator (soft at ~20s, firmer at ~60s). Keep the shipped fast deterministic catches (api_retry 403, AUTH_PATTERNS). Add opt-in env passthrough so power users can choose faster-fail without us imposing it.
todos:
  - id: rip-probe-verdict
    content: "Remove the latency-verdict + get_context_usage probe call + wedgedNotice posting from fireConnectProbe (the disproven 175 mechanism); keep the connect-window timer/arm/disarm wiring to drive the elapsed indicator instead"
    status: pending
  - id: elapsed-msgs
    content: "Add host→webview messages for the two escalation stages (e.g. turnWaiting with a stage/elapsed payload), posted from the connect-window timer(s); no verdict, no kill"
    status: pending
  - id: elapsed-ui
    content: "Render the escalating indicator in SessionStatus (soft 'still working (Ns)' at ~20s; firmer 'taking a while — keep waiting or Respawn' at ~60s); auto-clear on message_start / turn end / apiError; mirror the existing `retrying` signal pattern"
    status: pending
  - id: remove-wedged-card
    content: "Remove the wedgedNotice card path added to AuthErrorCard in 175 (the soft card is superseded by the SessionStatus elapsed indicator); keep the apiError auth card untouched"
    status: pending
  - id: prune-promptpane-respawn
    content: "Remove the prompt-pane respawn button + respawnAvailable gating from PromptPane (skull is the mid-turn kill; skull+Resume == respawn). KEEP the auth-error card's Respawn button — it reads naturally after a dead-session auth error."
    status: pending
  - id: env-opt-in
    content: "Expose CLAUDE_CODE_MAX_RETRIES and API_TIMEOUT_MS as opt-in via the existing ccvc.environment.variables passthrough — document them (don't hardcode defaults); confirm they reach spawnEnv"
    status: pending
  - id: verify-bbpi
    content: "Verify: missing-creds turn shows the escalating indicator (not a false wedged verdict) and never hangs silently; a slow-but-healthy turn shows the same honest indicator and still succeeds. BBPI."
    status: pending
isProject: false
---

# Honest elapsed indicator (replace the unreliable wedged probe verdict)

## Background

The whole wedged-detection line of work converged on one hard truth: **"slow" vs
"wedged" is undecidable from outside the process.** Three independent proofs (see
[doc/ref/claude_cli_tty_vs_piped_auth_timing.md](ref/claude_cli_tty_vs_piped_auth_timing.md)
and [doc/archive/wedged_vs_slow_experiment.plan.md](archive/wedged_vs_slow_experiment.plan.md)):

1. **Elapsed silence** can't distinguish them (190s = healthy-on-bad-network OR wedged).
2. **Probe latency** can't either — the appcloud9.175 production run measured a wedged
   `get_context_usage` at **2076ms**, overlapping the healthy 3.6–12s range. The clean
   53ms-vs-7000ms separation from the single experiment sample was luck (n=1). The
   verdict is unreliable and currently ships a judgment we've disproven.
3. **Even the terminal can't** — when creds were scuttled it also just sat there (~80s),
   it doesn't diagnose.

The binary inspection settled *why* the terminal feels better despite also being slow:
it **never goes silent** — its spinner renders the whole time (TTY-gated), while our
piped `stream-json` subprocess suppresses all progress and looks dead. The retry budget
is identical in both modes (default 10 retries, 600s timeout); the difference is
communication, not detection.

**The bar** (user-stated): parity with the terminal is success; hanging *longer* than
the terminal is the failure that loses developers. And the solution must be **general**
(any provider, private + company), not AWS-specific, and must not change the CLI's retry
behavior (which would degrade the legitimate flaky-network case — the exact T-Mobile
scenario where 10 retries are doing their job).

So: **stop diagnosing, start communicating.** Replace the probe verdict with an honest,
escalating elapsed indicator that makes no wedged-vs-slow claim — exactly the terminal's
real advantage, generalized.

## Approach

Three moves, plus an opt-in escape hatch:

1. **Rip out the disproven verdict** (`rip-probe-verdict`, `remove-wedged-card`): drop the
   `get_context_usage` latency probe, the `< 500ms ⇒ wedged` verdict, the `wedgedNotice`
   post, and the wedged card in AuthErrorCard. Keep the connect-window **timer**
   (arm on turn open / disarm on message_start, turn end, reset) — it's the right trigger,
   just repurposed to drive a status indicator rather than a judgment.

2. **Escalating elapsed indicator** (`elapsed-msgs`, `elapsed-ui`): two stages, both
   non-destructive, neither claiming to know *why* it's slow:
   - **~20s** of message_start-less silence → soft: "Still working… (Ns)".
   - **~60s** → firmer: "This is taking a while — keep waiting or Respawn." (elapsed
     ticking; Respawn/Open Terminal available, never auto-invoked).
   Auto-clears the instant `message_start` arrives, the turn ends, or an `apiError`
   fires. Rendered in SessionStatus, mirroring the existing `retrying` signal pattern.

3. **Keep the shipped fast catches** (no change): api_retry **401/403** → auth card ~2s
   (the common expired-token case); `AUTH_PATTERNS` incl. "Could not load credentials
   from any providers" → auth card when the definitive string lands. These remain the
   best-case fast paths; the elapsed indicator is the general safety net for everything
   else, including the silent provider-chain hang.

4. **Opt-in env passthrough** (`env-opt-in`): surface `CLAUDE_CODE_MAX_RETRIES` and
   `API_TIMEOUT_MS` as things a user *can* set (via the existing `ccvc.environment.variables`
   passthrough — they already reach `spawnEnv`). Document them; do NOT hardcode lowered
   defaults (that would degrade the flaky-network case and isn't general). Power users who
   want faster-fail opt in; everyone else inherits the terminal's behavior.

## Files to modify

- [src/subprocess.ts](../src/subprocess.ts) — `fireConnectProbe`: remove probe call +
  verdict + `wedgedNotice`; instead the connect-window timer(s) post the escalating
  `turnWaiting` messages. Keep `armConnectProbe`/`clearConnectProbe` and their existing
  call sites (turn open / message_start / turn end / reset). Likely split the single
  60s timer into two (≈20s soft, ≈60s firm), or re-arm the second on the first's fire.
  Remove `WEDGED_LATENCY_MS`; keep/rename the timing constants.
- [src/webview/vscode.ts](../src/webview/vscode.ts) — replace the `wedgedNotice` message
  (added 175) with a `turnWaiting` message carrying `{ stage: 'soft' | 'firm', elapsedMs? }`.
- [src/webview/components/SessionStatus/SessionStatus.tsx](../src/webview/components/SessionStatus/SessionStatus.tsx)
  — add a `waiting` signal + listener mirroring `retrying`; fold into the resolver/
  displayText. Clear on the same events `retrying` clears on (turnActivity opening/active/
  done, setProcessing false, ready, apiError).
- [src/webview/components/AuthErrorCard/AuthErrorCard.tsx](../src/webview/components/AuthErrorCard/AuthErrorCard.tsx)
  — remove the `wedged` signal + the wedged card branch added in 175. Leave the apiError
  auth-card path untouched.
- [src/webview/components/PromptPane/PromptPane.tsx](../src/webview/components/PromptPane/PromptPane.tsx)
  — remove the `respawn-btn` + its `respawnRequest`/`canRespawn` gating
  (`prune-promptpane-respawn`). Leave the `respawnAvailable` signal + `respawn` message +
  `respawnAndResend()` host handler intact — the auth-error card still uses them.
- [package.json](../package.json) — bump appcloud9.X to the next version. (No new config
  schema needed for env opt-in — it rides the existing `ccvc.environment.variables`; just
  document the two var names, e.g. in README or settings description.)

## Implementation details

### The indicator carries NO action button — skull already covers it

The elapsed indicator is pure information ("still working / taking a while"). It does
NOT need its own Respawn/kill affordance, because **the skull button is already surfaced
during a live turn** and is the honest kill path. Established with the user:

- **Skull vs respawn are effectively equivalent** — both `killProcess()` and re-read auth
  on the next spawn. The only delta: respawn continues the session in-place; skull parks
  to History and you Resume (one extra click). So skull + Resume == respawn.
- Therefore the **prompt-pane respawn button is removed** (`prune-promptpane-respawn`);
  skull is the single mid-turn kill control.
- The **auth-error card KEEPS its Respawn button** — after a dead-session auth error,
  "Respawn" reads more naturally than "Skull," and the session is already gone so there's
  nothing to park.
- At **Ready** status there's nothing to kill anyway: `+` starts a new session, or the
  user just continues / leaves.

So the indicator informs; skull (mid-turn) and the auth card's Respawn (post-error) act.
The timer is a trigger for *information*, never a watchdog that kills.

### Escalation timer shape (subprocess.ts)

```ts
const WAIT_SOFT_MS = 20_000;   // "still working" — past typical first-token (~5-7s)
const WAIT_FIRM_MS = 60_000;   // "taking a while" — past the healthy-slow tail (p99 ~20s, max ~45s)
let softTimer, firmTimer: NodeJS.Timeout | undefined;

function armWaitTimers(): void {
  clearWaitTimers(); sawMessageStart = false;
  softTimer = setTimeout(() => {
    if (sawMessageStart || apiErrorFired) return;
    deps?.postMessage({ type: 'turnWaiting', data: { stage: 'soft' } });
  }, WAIT_SOFT_MS);
  firmTimer = setTimeout(() => {
    if (sawMessageStart || apiErrorFired) return;
    deps?.postMessage({ type: 'turnWaiting', data: { stage: 'firm' } });
  }, WAIT_FIRM_MS);
}
function clearWaitTimers(): void { clearTimeout(softTimer); clearTimeout(firmTimer); softTimer = firmTimer = undefined; }
```

(Replaces `armConnectProbe`/`fireConnectProbe`; same call sites. The webview owns the
ticking elapsed seconds — SessionStatus already has an elapsed timer for the turn.)

### SessionStatus — reuse the `retrying` pattern verbatim

A `waiting` signal set by `on('turnWaiting')`, cleared by the same recovery events that
clear `retrying`. displayText precedence: apiError > waiting(firm) > waiting(soft) >
retrying > working/quiet > ready. SessionStatus already tracks `elapsedSeconds`, so the
"(Ns)" comes free.

## Edge cases

- **Healthy turn crossing 20s/60s on a slow network** (real, supported): the indicator
  shows — and that's CORRECT now. It makes no "stuck" claim; it says "still working /
  taking a while," which is true and matches the terminal's spinner. No false verdict.
- **message_start arrives at 19s**: soft timer disarmed; nothing shows. Good.
- **apiError fires first** (api_retry 403 / AUTH_PATTERNS): the auth card owns the UI;
  the indicator's `apiErrorFired` guard suppresses it, and the webview clears `waiting`
  on apiError. One surface, not two.
- **Turn recovers after firm stage**: message_start clears the indicator immediately.
- **Respawn from the firm indicator**: kills + fresh process, no resend (176). The
  in-flight turn is abandoned by the user's choice.

## What we are NOT doing

- **No wedged-vs-slow diagnosis.** Proven undecidable; the indicator states the symptom
  (elapsed time), never a cause.
- **No kill / auto-continue / watchdog action.** The timer triggers *information* only;
  recovery is user-initiated.
- **No lowered retry/timeout defaults.** That degrades the legitimate transient-failure
  case and isn't general. Faster-fail is opt-in only.
- **No AWS-specific logic.** `AWS_EC2_METADATA_DISABLED` etc. are NOT wired in; only the
  provider-agnostic `CLAUDE_CODE_MAX_RETRIES` / `API_TIMEOUT_MS` are documented as opt-in.
- **Not touching the shipped api_retry 403 / AUTH_PATTERNS catches** — they stay as the
  fast best-case paths.

## Open questions

- **Exact thresholds** — 20s/60s are defensible from the data (healthy p99 ~20s, max
  ~45s, terminal ~80s) but worth confirming live; the firm stage should land at/under the
  terminal's ~80s so we never feel slower than it.
- **One stage or two** — chose escalating (soft+firm). If two feels noisy in practice,
  collapse to a single ~45s stage.
- **Copy wording** — keep it symptom-only and calm: "Still working…", "Taking longer than
  usual — you can keep waiting or Respawn." Avoid "stuck"/"wedged"/"auth" (we don't know).
- ~~Where Respawn lives on the indicator~~ — RESOLVED: it doesn't. The indicator is
  information-only; skull (surfaced mid-turn) is the kill path, and the auth card keeps its
  Respawn. Prompt-pane respawn button removed.

---
name: Wedged-turn probe notice (event-triggered, latency-verdict)
overview: Turn the validated control-loop probe into a production soft-notice that tells the user a turn is wedged (stuck, will never respond) WITHOUT mis-firing on a slow-but-healthy turn. A connect-window timer only TRIGGERS a local get_context_usage probe; the probe's round-trip LATENCY is the verdict (fast = idle/wedged, slow = busy/healthy). Surfaces a non-destructive notice only. Builds directly on the appcloud9.173 instrumentation and the appcloud9.174 AUTH_PATTERNS fix already shipped.
todos:
  - id: probe-prod-tune
    content: "Promote the experiment probe to production: drop get_binary_version (useless discriminator), keep get_context_usage only; raise the connect-window threshold from 15s to ~60s; add a latency verdict (< ~500ms ⇒ wedged)"
    status: pending
  - id: probe-notice-msg
    content: "Add a host→webview message (e.g. wedgedNotice) posted ONLY when the probe verdict is 'wedged'; carry enough for the card to offer Respawn + Open Terminal"
    status: pending
  - id: probe-notice-ui
    content: "Render a soft, non-destructive 'Claude isn't responding' notice in the webview; auto-clear on message_start / turn end / apiError; offer Respawn (never auto-kill)"
    status: pending
  - id: probe-dedupe-authcard
    content: "Ensure the probe notice and the existing auth card don't double-fire: if AUTH_PATTERNS/api_retry already fired apiError this turn, suppress the probe notice (and vice-versa)"
    status: pending
  - id: probe-verify
    content: "Verify against the missing-creds repro: confirm the wedged notice appears ~60s in with a fast probe, and does NOT appear on a slow-but-healthy T-MOBILE turn. BBPI."
    status: pending
isProject: false
---

# Wedged-turn probe notice (event-triggered, latency-verdict)

## Background

Goal across this whole line of work: when a turn is **wedged** (credentials
missing/expired, or any silent stall where the CLI will never produce output),
tell the user **quickly** and offer recovery — **without** mis-firing on a
**slow-but-healthy** turn (degraded T-MOBILE network in the rain is a legitimate,
supported condition: *slow ≠ broken*).

What we already learned and shipped this session:

- **Elapsed silence cannot be the verdict.** A 190s wait can be a healthy turn on
  bad network OR a wedge. Same silence, same duration. (This is why the old
  wall-clock watchdog was deleted — see `turnHealth.ts` header.)
- **appcloud9.173** shipped the experiment instrumentation: a connect-window probe
  that, if no `message_start` arrives within a threshold, fires
  `get_binary_version` + `get_context_usage` and logs their round-trip latency
  (LOG-ONLY, no user action). See
  [doc/archive/wedged_vs_slow_experiment.plan.md](archive/wedged_vs_slow_experiment.plan.md).
- **appcloud9.174** shipped the deterministic auth-string fix: added
  `/could not load credentials from any providers/i` to `AUTH_PATTERNS`, plus a
  `classifyApiOrAuthError` helper (HTTP code first, then AUTH_PATTERNS) wired into
  both the assistant-text ingress and the result ingress, with the `is_error` gate
  dropped on the result path (the missing-creds error arrives as a SUCCESS-subtype
  result). That makes the **specific** missing-creds string fire the friendly auth
  card.
- **The experiment CONFIRMED the probe hypothesis** with real data:

  | turn type | network | `get_context_usage` latency |
  |---|---|---|
  | healthy (slow) | fast | 7132 ms |
  | healthy (slow) | T-MOBILE | 9961 ms |
  | **wedged (missing creds)** | fast | **53 ms** |

  ~150× separation. A **wedged** turn's control loop is idle (nothing streaming),
  so a local probe answers in tens of ms; a **healthy** turn's loop is busy
  servicing the API stream, so the probe is starved (7–10 s). Latency tracks
  **event-loop occupancy**, not the wire — degraded network made the healthy probe
  *slower*, not faster, so the signal is network-independent by mechanism.
  `get_binary_version` was useless (3–5 ms either way) — it's too lightweight to
  reflect occupancy.

This plan turns that validated probe into a **production soft-notice**. The timer
does NOT judge; it only **triggers** the probe. The probe's **latency** is the
verdict. This keeps faith with the "event/signal-based, not timer-based" principle:
the clock is just a trigger for a real measurement, never the conclusion itself.

## Approach

The instrumentation already exists in [src/subprocess.ts](../src/subprocess.ts)
(`armConnectProbe` / `clearConnectProbe` / `fireConnectProbe`, plus the
`sawMessageStart` guard and EXPERIMENT_PROBE_MS). Production changes:

1. **Tune the probe** (`probe-prod-tune`):
   - Drop `get_binary_version` from `fireConnectProbe` — keep only
     `get_context_usage` (the discriminating instrument).
   - Rename/keep `EXPERIMENT_PROBE_MS` as a production constant and raise it from
     `15_000` to `~60_000`. Rationale: the healthy-slow tail measured earlier had
     p99 ~20 s and a max healthy `status→message_start` of ~45 s, so 60 s sits
     comfortably past legitimate slow turns while still being ~3× faster than the
     old ~191 s silent hang.
   - Add a **latency verdict**: if the `get_context_usage` probe resolves in
     **< ~500 ms**, classify the turn as **wedged** (idle loop). If it's slow or
     times out, classify **healthy-but-slow** → do nothing. (Threshold lives in the
     wide gap between ~53 ms wedged and ~7000 ms healthy, so it's not sensitive.)

2. **Post a notice on the wedged verdict** (`probe-notice-msg`): a new
   host→webview message (e.g. `wedgedNotice`) posted ONLY when the verdict is
   wedged. No payload needed beyond enough to render the card.

3. **Render a soft notice** (`probe-notice-ui`): non-destructive card —
   "Claude isn't responding — it may be stuck (credentials may need a refresh)."
   with **Respawn** + **Open Terminal** buttons (reuse the AuthErrorCard pattern /
   buttons). **Never** auto-kill, never auto-continue. Auto-clears on
   `message_start` (turn recovered), turn end, or if an `apiError` fires.

4. **Dedupe with the auth card** (`probe-dedupe-authcard`): the 174 AUTH_PATTERNS
   path and the api_retry-403 path already fire the auth card for many cases. If
   `apiErrorFired` is already set this turn, the probe must NOT also post a wedged
   notice (and the probe notice should defer to a real apiError if one arrives
   after). One card, not two.

5. **Verify** (`probe-verify`): reproduce missing-creds (fast network) → expect the
   wedged notice ~60 s in; reproduce a slow-but-healthy T-MOBILE turn → expect NO
   notice. BBPI (bump appcloud9.X to the next version).

## Files to modify

- [src/subprocess.ts](../src/subprocess.ts) — the probe block already added in 173:
  `fireConnectProbe` (drop get_binary_version, add latency verdict + post on
  wedged), `EXPERIMENT_PROBE_MS` → production threshold (~60 s). Respect the
  existing `apiErrorFired` latch for dedupe. Arm/disarm wiring (turn open /
  message_start / turn end / reset) is already in place — reuse it.
- [src/webview/vscode.ts](../src/webview/vscode.ts) — add the `wedgedNotice`
  message to `MessageFromExtension` (beside `apiError` / `retrying`).
- A webview component for the notice — likely fold into the existing
  [AuthErrorCard](../src/webview/components/AuthErrorCard/AuthErrorCard.tsx)
  (it already does signal-driven, auto-clearing, Respawn + Open Terminal), OR a
  sibling card. The `retrying` notice in
  [SessionStatus](../src/webview/components/SessionStatus/SessionStatus.tsx) is the
  other precedent for an auto-clearing transient.

## Implementation details

`fireConnectProbe` production shape (evolving the 173 version):

```ts
async function fireConnectProbe(): Promise<void> {
  connectProbeTimer = undefined;
  if (sawMessageStart) { return; }      // healthy turn already streaming
  if (apiErrorFired) { return; }        // an auth/api error already owns the UI
  const t0 = Date.now();
  try {
    await sendControlRequest('get_context_usage');
    const latency = Date.now() - t0;
    if (latency < WEDGED_LATENCY_MS && !sawMessageStart && !apiErrorFired) {
      // Idle control loop while a turn is supposedly in flight ⇒ wedged.
      deps?.postMessage({ type: 'wedgedNotice', data: {} });
    }
    // slow / busy ⇒ healthy-but-slow ⇒ stay silent
  } catch {
    // timeout ⇒ loop busy / contended ⇒ healthy-but-slow ⇒ stay silent
  }
}
```

Constants:
- `CONNECT_PROBE_MS = 60_000` (was experiment's 15_000).
- `WEDGED_LATENCY_MS = 500` (well inside the ~53 ms vs ~7000 ms gap).

## Edge cases

- **Healthy turn that crosses 60 s to first token** (rare, but real on bad
  network): probe fires, but `get_context_usage` will be SLOW (busy loop) → verdict
  healthy → no notice. This is the whole point — latency, not time, decides.
- **message_start races the probe**: `sawMessageStart` guard + disarm on
  message_start already handle this (turn started streaming → no probe / no notice).
- **Auth card already fired** (api_retry 403, or the 174 credentials string): the
  `apiErrorFired` check suppresses the probe notice. No double card.
- **Probe itself times out** (15 s control timeout): treated as healthy-but-slow
  (busy loop) → no notice. Correct: a wedged idle loop answers fast, it doesn't
  time out.
- **Notice showing, then turn recovers**: auto-clear on message_start / turn end.
- **Multiple turns / warm reuse**: arm on turn open, disarm on close — already wired
  in 173; no probe leaks across turns.

## What we are NOT doing

- **No kill / auto-continue / destructive action.** Soft notice only; recovery is
  user-initiated (Respawn / Open Terminal), consistent with the compliance posture
  and the turn-health design philosophy.
- **No elapsed-time verdict.** The 60 s timer only TRIGGERS the probe; the probe's
  latency is the verdict. Time alone is never the conclusion.
- **No get_binary_version.** Proven useless as a discriminator; dropped.
- **No new auth handling.** We read the control loop's responsiveness and the error
  strings the CLI already emits — never credentials, never login.
- **Not re-doing the 174 AUTH_PATTERNS fix.** That deterministically handles the
  specific "Could not load credentials…" string already; the probe is the GENERAL
  catch-all for silent wedges that emit no recognizable string.

## Open questions

- **Exact threshold values** — 60 s trigger / 500 ms verdict are well-justified by
  the data but could be tuned after a week of production `wedgedNotice` telemetry
  (log the verdict + latency even in production, like the experiment did).
- **One card or two** — fold the wedged notice into AuthErrorCard (shared Respawn /
  Open Terminal, similar copy) or keep a distinct softer card? Lean: reuse
  AuthErrorCard with wedged-specific copy, since the recovery actions are identical.
- **Copy** — "Claude isn't responding — it may be stuck; credentials may need a
  refresh" vs. something less presumptuous about the cause (the probe proves
  *wedged*, not specifically *auth*). Lean: name the symptom (not responding) and
  offer Respawn, mention auth as the likely-but-not-certain cause.
- **Keep logging the probe verdict in production?** Yes — cheap, and lets us tune
  thresholds from real data (same EXPERIMENT-style tag).

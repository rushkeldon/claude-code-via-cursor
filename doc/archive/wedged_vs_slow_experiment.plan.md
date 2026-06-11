---
name: Wedged-vs-slow probe experiment
overview: Validate that a local control-channel probe's round-trip LATENCY can distinguish a wedged turn (missing/expired creds — control loop idle, answers fast) from a slow-but-healthy turn (live stream occupying the event loop — probe starved/slow), independent of network speed. Phase 1 wires instrumentation that only LOGS (no user-facing action); Phase 2 runs a deliberate 5-cell condition matrix in SBS mode to gather data; Phase 3 analyzes and picks the threshold + probe before any notice is wired.
todos:
  - id: phase1-instrument
    content: "Phase 1: wire a connect-window probe (fires at a low experiment threshold when no message_start yet) that sends get_binary_version + get_context_usage and logs BOTH round-trip latencies with a distinctive EXPERIMENT tag — no user-facing action. BBPI."
    status: pending
  - id: mark-log-start
    content: "Record the experiment start timestamp (and confirm the EXPERIMENT log tag greps cleanly) so the dataset is isolable without deleting log history."
    status: pending
  - id: cell1-baseline
    content: "Cell 1 — valid auth + fast network: capture one healthy baseline turn with the new instrumentation (probe should NOT fire; message_start arrives ~4s)."
    status: pending
  - id: cell2-slow-healthy
    content: "Cell 2 — valid auth + SLOW (T-Mobile) network: healthy but slow turn. Probe fires; expect probe latency SLOW/timeout (event loop busy streaming). The false-positive guard."
    status: pending
  - id: cell3-garbled-token
    content: "Cell 3 — garbled token + fast network: API returns 403 → expect the shipped api_retry path to fire ~2s. Re-validates the shipped fix; probe may not even be needed."
    status: pending
  - id: cell4-missing-fast
    content: "Cell 4 — missing creds + fast network: silent hang. Probe fires; expect probe latency FAST (control loop idle). The core mechanism."
    status: pending
  - id: cell5-missing-slow
    content: "Cell 5 — missing creds + SLOW network: silent hang on bad network. Probe fires; expect probe latency STILL FAST. THE KILLER — proves the signal is network-independent."
    status: pending
  - id: phase3-analyze
    content: "Phase 3: analyze all captured probe latencies across cells. Confirm (or refute) that probe latency cleanly splits wedged (fast) from slow-healthy (slow). Pick the probe + production threshold, or conclude the signal isn't reliable."
    status: pending
isProject: false
---

# Wedged-vs-slow probe experiment

## Background

We want to detect a *wedged* turn (credentials missing or expired — the CLI is
stuck and will never produce output) and surface it to the user **quickly**,
without a destructive action, and **without** mis-firing on a *slow-but-healthy*
turn (e.g. degraded T-Mobile network in the rain, which is a legitimate
supported condition — slow ≠ broken).

Prior investigation (see [doc/archive/network_auth_error_handling.plan.md](archive/network_auth_error_handling.plan.md)
and the 2026-06-10 logs) established hard constraints:

- **Elapsed silence cannot distinguish the two.** A 190s wait can be a healthy
  turn on bad network OR a creds hang. Same silence, same duration. This is why
  the old wall-clock watchdog was deleted (`turnHealth.ts` header comment).
- **The missing-creds hang is signal-less on the stream:** after `system/status`
  it emits zero stream events, zero stderr (through our pipes), and no natural
  terminal event — the `error_during_execution` we saw only fired because the
  user manually interrupted.
- **`get_context_usage` is ambiguous as a pass/fail probe:** it *times out* on
  slow-healthy turns (rainstorm window, 01:00–03:00 on 2026-06-10) yet
  *succeeded in ~1.0s* on the one missing-creds hang.

That last point is the lead. The **inverted latency** is the hypothesis:

> A local control-channel probe (no network, no model turn) answers **fast** when
> the CLI's single-threaded event loop is **idle** (wedged turn: parked in
> credential resolution, nothing to do), and answers **slow / times out** when the
> loop is **busy** servicing a live API stream (healthy turn). So probe *latency*
> measures event-loop occupancy — the real difference between wedged and working —
> rather than elapsed time, which we proved can't tell them apart. Crucially, a
> local probe never touches the network, so its latency should be **independent of
> connection speed**.

This experiment validates (or refutes) that hypothesis on **deliberately
reproduced** conditions, because we have exactly **n=1** on the wedged side and
the one slow-network timeout is confounded (could be whole-connection
degradation, not specifically loop-busy). We do not wire any user-facing notice
until the mechanism is proven on real, fresh data.

## Approach

Three phases. **Phase 1 is build-only and costs zero downtime** (instrumentation
that only logs). **Phase 2 is the deliberate-breakage matrix, run in SBS mode** —
one cell per step: the assistant prompts the user to create the condition, the
user creates it and runs a turn, the probe fires and logs, the user says "done,"
we move to the next cell. **Phase 3 analyzes and decides.**

The probe is sent over the existing control channel (`sendControlRequest` in
[src/subprocess.ts](../src/subprocess.ts)) — the same mechanism already used for
`initialize` / `interrupt`. Candidate probes (both local, no model turn, per
[doc/ref/control_protocol_surface.md](ref/control_protocol_surface.md)):

- **`get_binary_version`** — leanest; pure event-loop liveness, returns CLI
  version. Best theoretical occupancy signal.
- **`get_context_usage`** — what we already have historical data on, so firing it
  too lets us cross-reference the existing 2026-06-10 samples.

We fire **both** at the threshold and log both latencies, so Phase 3 picks the
cleaner discriminator from data rather than a guess.

### Why these specific cells

| # | Auth | Network | Expected probe latency | Validates |
|---|------|---------|------------------------|-----------|
| 1 | valid | fast | n/a (probe doesn't fire) | baseline / no false fire |
| 2 | valid | **slow** | **slow / timeout** (loop busy) | false-positive guard |
| 3 | garbled token | fast | n/a (api_retry 403 fires ~2s) | shipped fix still works |
| 4 | **missing creds** | fast | **fast** (loop idle) | core mechanism |
| 5 | **missing creds** | **slow** | **still fast** | **network-independence — the killer** |

Cell 5 is decisive: if a wedged turn on slow network *still* answers the probe
fast, the signal is proven network-independent — exactly what we need to honor
"slow ≠ broken."

## Files to modify

- [src/subprocess.ts](../src/subprocess.ts) — add the connect-window probe: arm a
  timer in `beginTurn`/at the turn-open boundary; on expiry **if no
  `message_start` has arrived**, fire `get_binary_version` + `get_context_usage`
  via `sendControlRequest`, measure each round-trip, and `log.info` both with the
  `EXPERIMENT` tag and the turn outcome correlator. Disarm the timer on
  `message_start` and on turn end. **No `postMessage`, no notice, no kill** in
  Phase 1.
- [src/turnHealth.ts](../src/turnHealth.ts) — likely untouched; the probe timer
  lives in subprocess.ts next to the stream handling, NOT in the presentation-only
  turn-health monitor (keep that module action-free as designed).

## Implementation details (Phase 1)

Pseudocode for the probe, placed in subprocess.ts near the stream handling:

```ts
// EXPERIMENT (doc/wedged_vs_slow_experiment.plan.md): connect-window probe.
// Fires ONCE per turn if no message_start arrived within the experiment
// threshold. Measures local control-loop round-trip latency for two probes to
// test whether latency distinguishes a wedged (idle loop → fast) from a
// slow-but-healthy (busy loop → slow) turn. LOG ONLY — no user-facing action.
const EXPERIMENT_PROBE_MS = 15_000;   // low for fast iteration; production ~60s
let sawMessageStart = false;
let probeTimer: NodeJS.Timeout | undefined;

function armConnectProbe(): void {
  clearConnectProbe();
  sawMessageStart = false;
  probeTimer = setTimeout(fireConnectProbe, EXPERIMENT_PROBE_MS);
}
function clearConnectProbe(): void {
  if (probeTimer) { clearTimeout(probeTimer); probeTimer = undefined; }
}
async function fireConnectProbe(): Promise<void> {
  if (sawMessageStart) { return; }   // healthy turn already streaming
  for (const subtype of ['get_binary_version', 'get_context_usage']) {
    const t0 = Date.now();
    try {
      await sendControlRequest(subtype);
      log.info('Experiment', 'connect-probe', {
        tag: 'EXPERIMENT', subtype, ok: true, latencyMs: Date.now() - t0,
      }, '🧪');
    } catch (e: any) {
      log.info('Experiment', 'connect-probe', {
        tag: 'EXPERIMENT', subtype, ok: false, latencyMs: Date.now() - t0,
        error: e?.message ?? String(e),
      }, '🧪');
    }
  }
}
```

Wiring:
- Call `armConnectProbe()` where the turn opens (same place `turnHealth.beginTurn()`
  is called, ~line 476).
- In the `message_start` handler (~line 1304): `sawMessageStart = true; clearConnectProbe();`
- On turn end / reset / error: `clearConnectProbe();`

Note: `Date.now()` is fine here (real extension-host runtime, not a workflow
script).

### Experiment threshold vs. production threshold

Use **15s** during the experiment so each wedged sample takes ~20s, not 193s. The
user can interrupt the moment the probe has logged. The production threshold (if
we ever wire a notice) would be ~60s — set after Phase 3.

## SBS execution protocol (Phase 2)

This plan is built to run in **sbs mode**. Each `cellN-*` todo is ONE step. For
each, the assistant:
1. Flips the todo to `in_progress`.
2. Prompts the user with the EXACT condition to create (recipes below).
3. Waits. The user creates the condition, sends a turn in the extension, waits
   for the probe to log (~15–20s), then says "done."
4. The assistant reads the fresh `EXPERIMENT`-tagged log lines, records the
   probe latencies in the todo's markdown notes, flips to `completed`, and stops.
5. Next step on the next "done."

### Condition recipes (keep handy)

**Skull is mandatory after any auth change** — the warm process holds creds in
memory; only a fresh spawn re-reads them. Check real expiry with
`awsmyid expires --profile twdc-bedrock-central`.

- **Valid + fast (cell 1):** normal state, fast network. Just send a turn.
- **Valid + slow (cell 2):** switch to T-Mobile network, keep valid auth, send a
  turn. (Wet trees a bonus — more realistic degradation.)
- **Garbled token (cell 3):** keep the `[twdc-bedrock-central]` section but corrupt
  `aws_session_token`; skull; send a turn. Restore after.
- **Missing creds (cells 4, 5):**
  ```bash
  cp ~/.aws/credentials ~/.aws/credentials.bak      # backup
  # remove the [twdc-bedrock-central] section
  # SKULL in the extension, then send a turn
  cp ~/.aws/credentials.bak ~/.aws/credentials      # restore when done
  ```
  Cell 5 = same, but on the T-Mobile slow network.
- **Recover to working:** restore creds (`cp …bak`), run `ca` if the SSO session
  also lapsed, then **skull** so the next turn spawns a fresh authenticated
  process.

### Reading the data per cell

```bash
LOGDIR="$HOME/Library/Application Support/claude-code-via-cursor/Logs"
grep "EXPERIMENT" "$LOGDIR"/claude-code-via-cursor-$(date -u +%F).log | tail -10
```

Record, per cell: did the probe fire? `get_binary_version` latency (ok/latencyMs),
`get_context_usage` latency (ok/latencyMs), and the eventual turn outcome
(message_start time / error / interrupted).

## Edge cases

- **Probe itself adds load:** firing two control requests is cheap, but log the
  order so we can see if the second is skewed by the first. They run sequentially
  by design (await each) to keep latencies clean.
- **message_start races the probe:** the `sawMessageStart` guard + disarm on
  `message_start` means a turn that starts streaming just before the threshold
  won't probe. That's correct (it's healthy).
- **Control request times out:** `sendControlRequest` rejects at
  `CONTROL_TIMEOUT_MS` (15s). A timeout IS a data point (loop too busy / wedged at
  the control layer) — log it with `ok:false`, don't treat as an error.
- **Multiple turns / warm reuse:** arm on every turn open, disarm on every close,
  so a probe never leaks across turns.
- **Don't delete logs:** keep history (today's log holds the real morning
  incident — our ground truth). The `EXPERIMENT` tag isolates the new data.

## What we are NOT doing

- **No user-facing notice in this plan.** Phase 1 only logs. Wiring a notice to
  the verdict is a *follow-on* plan, written only after Phase 3 proves the signal.
- **No kill / auto-continue / destructive action** — ever, consistent with the
  turn-health design philosophy.
- **No reliance on elapsed time as the verdict** — the timer only *triggers a
  probe*; the probe's latency is the verdict. Time alone is explicitly rejected as
  a discriminator.
- **Not touching the shipped api_retry 403 path** — cell 3 just re-confirms it.

## Open questions

- **Which probe wins?** `get_binary_version` (leanest) vs `get_context_usage`
  (has historical data). Phase 3 decides from the latency split.
- **Production threshold?** ~60s is the working assumption; confirm against cell-2
  data that healthy-slow turns reliably have a streaming `message_start` (or a
  busy/slow probe) by then.
- **Is the inverted-latency mechanism real or coincidence?** The whole experiment
  exists to answer this. If cells 4/5 do NOT show fast probes, the hypothesis is
  refuted and we fall back to signal-only detection (shipped api_retry path) plus
  accepting the missing-creds case as undetectable.

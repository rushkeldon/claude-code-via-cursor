# Claude CLI: TTY vs piped behavior, and the slow auth-failure hang

**Status: reference / findings.** Not a plan. Captures what we learned about why the
`claude` CLI surfaces a missing-credentials failure faster in a terminal (~80s) than
when we run it as a piped `stream-json` subprocess (~174s), and what (if anything) we
should do about it. Read this before re-investigating; the binary inspection here was
expensive.

## The question

When AWS credentials are missing/unresolvable:
- **Terminal (interactive TTY):** the user sees the failure in **~80s**.
- **Our extension (piped subprocess, `--output-format stream-json`):** hangs **~174s**
  with zero stream events / zero stderr, then finally emits
  `API Error: Could not load credentials from any providers`.

Same binary underneath both (`claude` v2.1.170, a ~222MB Bun-compiled Mach-O with an
embedded minified JS bundle). So the difference is something the CLI does differently
by mode — the question was *what*, and whether there's a lever to make our subprocess
fail as fast as the terminal.

## Hard constraints that frame the answer

Established across the broader investigation (see
[doc/archive/wedged_vs_slow_experiment.plan.md](../archive/wedged_vs_slow_experiment.plan.md)):

- **"Slow" vs "wedged" is undecidable from outside the process.** Elapsed silence can't
  tell them apart; probe-latency can't either (a wedged probe measured 53ms once and
  2076ms the next — overlapping the healthy 3.6–12s range). Even the terminal doesn't
  *diagnose* — it just shows a spinner and trusts the human.
- **The bar is parity with the terminal, not beating it.** ~80s is slow, but if the
  terminal does it, matching it passes. Hanging *longer* than the terminal is the
  failure — that's what loses developers.
- **We want a GENERAL solution** (any provider, private users and companies), not one
  specific to AWS or this machine's work setup.
- **Compliance:** we never touch authentication. Passing env to the user's own `claude`
  process is fine; inspecting/handling credentials or aiding login is not.

## What the binary actually showed (read-only inspection)

### 1. Interactivity is decoupled from TTY
There is no single "am I interactive?" boolean driving behavior. The CLI carries an
explicit session flag `isNonInteractiveSession` / `isInteractive`, set by `--print` /
`--output-format stream-json` **independently** of whether a TTY is attached. `isTTY`
is read only for *rendering* (color depth, terminal width, alt-screen, spinner) — e.g.
telemetry tracks `print` and `isTTY:process.stdout.isTTY??false` as *separate* fields.

### 2. Retry budget and request timeout are NOT mode-gated
Both modes use the same values:
- `CLAUDE_CODE_MAX_RETRIES` — default **10** (`function C7O(){if(process.env.CLAUDE_CODE_MAX_RETRIES){…}return 10}`).
- `API_TIMEOUT_MS` — default **600000ms / 10min** per request (`parseInt(process.env.API_TIMEOUT_MS||String(600000),10)`).
- Backoff constants: base 1000ms, factor 1.6, max cap 120000ms, jitter 0.2.

No branch conditions `maxRetries`/`timeout` on interactivity. **So the 174s is NOT an
intentional "headless is slower" setting.**

### 3. The hang is the AWS provider chain × the outer retry loop
The "Could not load credentials from any providers" string is thrown by the standard
bundled `@aws-sdk/credential-provider-node` chain. The IMDS (EC2 metadata) leg defaults
to `maxRetries=0, timeout=1000ms` per attempt — so IMDS alone (~1s) doesn't explain
174s. The long wall-clock is **credential resolution (profile/SSO/STS/IMDS legs) failing,
then the main API client retrying up to 10× with exponential backoff**, the whole chain
re-running each pass. Backoff jitter explains why the duration varies run to run.

### 4. Progress rendering is TTY-gated (the real difference)
Spinner / alt-screen / status output is gated on `isTTY` (e.g.
`isInteractive(){return this.props.stdin.isTTY}` and many `if(...isTTY){...write...}`
blocks). When piped, those render paths are skipped — **so the terminal shows a
continuous spinner for the whole retry loop while our pipe goes completely silent.**
This is cosmetic (it doesn't change the budget) but it's *why* our wait reads as a dead
hang and the terminal's doesn't. The terminal's ~80s-vs-our-174s is most plausibly the
interactive client surfacing the error and short-circuiting the loop sooner, while the
silent headless pipe grinds the full retry ladder.

### 5. Env levers that exist (all just env passed to the user's own claude)
- **`CLAUDE_CODE_MAX_RETRIES`** — collapses the 10-retry outer loop (biggest lever on
  the 174s). `0` disables retries entirely; `1` keeps one.
- **`AWS_EC2_METADATA_DISABLED=true`** — short-circuits the IMDS leg immediately
  (AWS-specific).
- **`API_TIMEOUT_MS`** — caps each request attempt (doesn't reduce retry count).
- **`CLAUDE_CODE_SKIP_BEDROCK_AUTH`** — skips AWS auth resolution entirely (Bedrock only).
- Not relevant: `CLAUDE_CODE_AUTH_FAIL_EXIT_MS` (OAuth-401 zombie watchdog, default
  600000ms — only fires on repeated 401s, not AWS cred resolution);
  `CLAUDE_CODE_STALL_TIMEOUT_MS_FOR_TESTING` (binary self-update download watchdog).

## Recommendation

**Do not** lower `CLAUDE_CODE_MAX_RETRIES` (or set AWS-specific env) as a default. It
cuts against every constraint above:

- It's **AWS-specific** in the IMDS case, and not general.
- It **changes the CLI's behavior** rather than inheriting it.
- Most importantly, truncating retries **degrades the legitimately-transient case** —
  the exact T-Mobile-in-the-rain / flaky-network scenario where those 10 retries are
  doing their job and *would* recover. Cutting to 1 could make us fail turns the
  terminal would have ridden out — i.e. make us **worse** than the terminal, the one
  outcome we said is unacceptable.

The liberating finding: **the terminal isn't faster because of a setting — it's better
because it never goes silent.** Its spinner runs the entire time. So the faithful,
general fix that matches "parity, general, don't change CLI behavior" is **not** an env
var that truncates retries — it's giving the user the **same continuous feedback the
terminal gives**, so a long wait reads as "still working (47s…)" instead of a dead hang.
That is exactly the "honest elapsed indicator, stop trying to diagnose" conclusion the
probe experiment already pointed to.

Concretely, the recommended direction (to be turned into a plan separately):

1. **Revert the unreliable probe *verdict*** (appcloud9.175): the latency-based
   wedged/healthy judgment is disproven (53ms vs 2076ms overlap). Keep the connect-window
   *timer* and *logging*, drop the auto-`wedgedNotice` verdict.
2. **Add an honest elapsed indicator** — after a silence threshold with no `message_start`,
   show a non-diagnostic, non-destructive notice: "Still waiting for Claude… (Ns) — it may
   be slow or stuck; keep waiting or Respawn." Elapsed time ticking, Respawn / Open
   Terminal offered. Makes no wedged-vs-slow claim (because that's undecidable). This is
   the terminal's actual advantage, generalized to every provider.
3. **Keep the already-shipped fast deterministic catches** — they remain the best-case
   path and are provider-agnostic:
   - api_retry **401/403** → auth card in ~2s (appcloud9.173; the common expired-token case).
   - `AUTH_PATTERNS` incl. "Could not load credentials from any providers" → auth card
     whenever the definitive string arrives (appcloud9.174).
4. **Optionally expose `CLAUDE_CODE_MAX_RETRIES` / `API_TIMEOUT_MS` as opt-in env
   passthrough** in settings — let a user who *wants* faster-fail choose it, without us
   imposing it (and without degrading the default flaky-network experience).

## Provenance

- Binary inspected: `/Users/keldon/.local/share/claude/versions/2.1.170` (v2.1.170),
  read-only `strings` extraction of the embedded JS bundle, 2026-06-10.
- Companion control-protocol reference:
  [doc/ref/control_protocol_surface.md](control_protocol_surface.md).
- Experiment that established the undecidability + the probe data:
  [doc/archive/wedged_vs_slow_experiment.plan.md](../archive/wedged_vs_slow_experiment.plan.md).
- Shipped detection to date: appcloud9.173 (api_retry 403 fast-path + probe
  instrumentation), .174 (AUTH_PATTERNS credentials string), .175 (probe notice — verdict
  now considered unreliable, slated for revert), .176 (respawn no longer auto-resends).

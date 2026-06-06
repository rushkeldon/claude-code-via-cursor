# Thoughts on thoughts — how to get the thinking pane working again at a good level

**Status: VERIFIED AGAINST THE ACTUAL BINARY.** The diagnosis below was confirmed
first-party against the real `claude` 2.1.165 native binary and the matching SDK
type definitions (see [§5](#5-resolved--verified-against-the-binary) and
[§10](#10-verification-log--exactly-what-was-tested)). The originally-flagged
load-bearing unknown is now **resolved**. The single remaining gap is one
auth-only confirmation, called out explicitly in §5 — everything else here is
tested, not inferred.
**Audience:** the other agent working this area. Read alongside
[`thoughts_report.md`](thoughts_report.md) (the on-disk log forensics) and
[`control_protocol_surface.md`](control_protocol_surface.md) (the wire protocol map —
its "Verified live" and "Thinking *display*" sections share this evidence).

**Date:** 2026-06-05. **Verified by:** driving the native binary's stream-json
control channel directly + reading its embedded migration guide (methodology in §10).

---

## TL;DR

The thinking pane went dark **the instant the session pinned to
`us.anthropic.claude-opus-4-8`**. The log forensics in `thoughts_report.md`
established the signature precisely: thinking blocks still **open** and still emit a
**`signature_delta`**, but **no `thinking_delta` text** arrives in between.

**The binary's own embedded Opus 4.8 migration guide resolves *why*** (these are
verbatim strings extracted from the 2.1.165 native binary — see §10):

> **Thinking content omitted by default.** · "`thinking.display` defaults to
> `"omitted"`; set `"summarized"` if you surface reasoning to users." · "Thinking
> blocks still appear in the response stream on Claude Opus 4.7, but their
> `thinking` field is empty unless you explicitly opt in. This is a silent change
> from Claude Opus 4.6, where the default [was summarized]." · "`thinking:
> {type:'enabled', budget_tokens:N}` is no longer supported on Claude Opus 4.7 or
> later models and returns a 400 error."

So the model **is still thinking** (the `signature_delta` is the cryptographic proof
that real thinking content was produced and signed) — but **Opus 4.8 defaults the
*display* of that thinking to `"omitted"`**, so no summarized text is ever streamed
to us. **Opus 4.6 defaulted to `"summarized"`**, which is exactly why it "used to
work" and silently broke on the model switch. This is a **display-mode default
change, not a thinking-budget problem.**

The fix we want: get the session into **`display: "summarized"`** for the Opus 4.8
path. "Summarized" is a curated digest of the model's reasoning — **not** the raw
firehose of every token — which matches the level the user remembers and liked.

**That open question is now RESOLVED** (see [§5](#5-resolved--verified-against-the-binary)).
The CLI lever is a **settings key**, not a request field and not the `initialize`
handshake: set **`thinkingDisplay: "summarized"`** (with `showThinkingSummaries:
true`) in the settings the CLI reads — verified accepted live via
`apply_flag_settings`, and most durably placed in the same
`.claude/settings.local.json` the extension already writes the model into.

---

## 1. Two dials, not one — this is the key mental model

Thinking is controlled by **two orthogonal knobs**. Conflating them is what makes
this confusing.

| Dial | Values | Controls | Where it lives |
|---|---|---|---|
| **`effort`** | `low \| medium \| high \| xhigh \| max` | *How much the model actually thinks* (depth + token spend) | `output_config.effort` (API); replaced the old fixed budget |
| **`thinking.display`** | `omitted \| summarized` | *Whether we get to see the thinking text* | `thinking.display` (API) |

They're independent. The model can think hard (`effort: high`) and show you **nothing**
(`display: omitted`) — which is **precisely our current state on Opus 4.8.** The
`signature_delta` with no `thinking_delta` is the visible fingerprint of exactly that
combination: thinking happened, display was omitted.

**Our bug is the second dial, not the first.** We don't need the model to think
*more*; we need it to *show* a summary of the thinking it's already doing.

---

## 2. What `max_thinking_tokens` actually means — and why it's a red herring here

`control_protocol_surface.md` lists an outbound control request:

> `set_max_thinking_tokens` | `{ max_thinking_tokens: number \| null }` — real
> thinking budget; replaces the THINK/ULTRATHINK prompt-prefix hack.

That is the **legacy fixed-budget** lever — the old `thinking: {type: "enabled",
budget_tokens: N}` model where you handed the model a hard token allowance to think
within. **On Opus 4.8 / 4.7 that mechanism is removed** — sending a fixed
`budget_tokens` now returns a **400**. Opus 4.8 uses **adaptive** thinking: the model
decides how much to think per turn, and you steer *depth* with `effort`, not a token
count.

**Implication:** `set_max_thinking_tokens` is **not** the fix for the dark pane, and
chasing it would be a dead end. Budget was never the problem (the model is thinking
fine — it's signing thinking blocks). The problem is **display mode**. If anything,
`set_max_thinking_tokens` is largely **vestigial** for the pinned `[1m]` model.

> Worth knowing for the *separate* effort question, but file it away: a fixed thinking
> budget is gone; if we ever want to influence thinking *depth* on 4.8, the lever is
> `effort`, exposed over the wire as part of settings/flags — not `max_thinking_tokens`.

---

## 3. How thinking tokens are billed (for the "I don't want every stray thought" concern)

Thinking tokens are billed as **output tokens** — same meter, same rate as the
visible response. There is **no separate thinking-budget line item**. For Opus 4.8:

- Input: **$5 / 1M tokens**
- Output (includes all thinking): **$25 / 1M tokens**

So more visible thinking = more output tokens = more cost **and** more latency. This
is why **`summarized` is the right target, not raw thinking**: it's both the level the
user wants *and* the cheaper one. (Raw, unsummarized thinking isn't even a selectable
display mode on 4.8 — `summarized` *is* the "show me the inner thoughts" setting.
There is no firehose mode to accidentally turn on.)

---

## 4. What the extension does today (and why it's now obsolete)

Confirmed by reading `src/subprocess.ts`:

- **Spawn args** (`spawnProcess`, ~ln 433): `--output-format stream-json`,
  `--input-format stream-json`, `--include-partial-messages`, `--verbose`,
  `--permission-prompt-tool stdio`. **No thinking/display flag of any kind.**
- **The only thinking lever is a prompt-prefix hack** (`runTurn`, ln 332–351): when
  "thinking mode" is on, it prepends `THINK` / `THINK HARD` / `THINK HARDER` /
  `ULTRATHINK` + `" THROUGH THIS STEP BY STEP:"` to the user's message, keyed off a
  `claudeCodeChat.thinking.intensity` setting.
- **The parser is healthy** (StreamParser, ln 1129–1141): it posts `thinkingBlockStart`
  on a `thinking` `content_block_start`, and `thinkingDelta` on each `thinking_delta`.
  It even logs `"thinking_delta has empty chunk"` when the delta carries no text. The
  logs show it simply isn't *receiving* `thinking_delta` text — consistent with
  `display: omitted`.
- The non-streamed path (ln 1238) reads `content.type === 'thinking'` from the full
  assistant message — also empty, for the same reason.

**Why the prompt-prefix hack is now obsolete:** `THINK`/`ULTRATHINK` are magic words
that, on older models, nudged thinking *depth*. On Opus 4.8 that role belongs to
`effort`, and — critically — **no amount of prompt-prefixing changes the `display`
mode.** You can `ULTRATHINK` all day; if `display` is `omitted`, you still see nothing.
This is why bumping the intensity setting didn't bring the pane back. The hack targets
the wrong dial.

---

## 5. RESOLVED — verified against the binary

> ✅ **The previously load-bearing unknown is answered.** It was: *"how does CLI
> 2.1.165 let us request summarized thinking display?"* Verified by inspecting the
> SDK type definitions and the native binary's own embedded strings, and by driving
> the binary's live control channel (full methodology in [§10](#10-verification-log--exactly-what-was-tested)).

**Answer: it is a settings key — candidate #2 was right, candidate #1 (an
`initialize` field) was WRONG.** The `initialize` request carries no thinking/display
field at all (confirmed by dumping its type). The lever lives in the settings the CLI
reads:

- **`thinkingDisplay`** — `'summarized' | 'omitted'` (the direct mirror of the API's
  `thinking.display`).
- **`showThinkingSummaries`** — boolean (the user-facing "show me the summaries" flag).
- **`alwaysThinkingEnabled`** — boolean (keeps thinking on for supported models).

SDK type (`sdk.d.ts`): `ThinkingAdaptive = { type: 'adaptive'; display?: 'summarized' | 'omitted' }`.
Both `showThinkingSummaries` and `alwaysThinkingEnabled` appear as settings-shaped
keys, and all three appear verbatim in the binary's strings.

**Two ways to set it, both verified at the protocol layer:**

1. **In-band, live:** `apply_flag_settings { settings: { thinkingDisplay: 'summarized',
   showThinkingSummaries: true, alwaysThinkingEnabled: true } }`. I sent exactly this
   to the running binary; it returned `success` and a follow-up `get_settings` showed
   all three landing in `effective`.
2. **At spawn (recommended for the durable fix):** write `thinkingDisplay: "summarized"`
   into `.claude/settings.local.json` — the **same file the extension already writes the
   pinned model into** (`settings.ts`). Settings are re-read on every spawn, so this
   **survives in-band `set_model`** for free, which dissolves the §6.2 "re-assert after
   set_model" concern.

**The one remaining gap (auth-only, cannot be closed from a sandbox):** whether
setting the key actually makes `thinking_delta` *text* return on a real Opus 4.8 turn.
At the protocol layer the key is accepted, but `apply_flag_settings` wrote it into
`effective` while the resolved `applied` block did **not** surface it — so it's
unconfirmed whether a *live mid-session* apply flips display, or whether the key must
be present in `settings.local.json` **at spawn**. This needs an authenticated turn
against `opus-4-8[1m]` (watch for `thinkingDelta sent` returning in the host logs). Use
`probe_thinking.mjs` at the repo root, or just A/B it per §7. **Prefer the
spawn-time settings.local.json path** until the live-apply path is proven.

---

## 6. Recommended fix (contingent on §5)

Assuming verification finds a CLI thinking-display control:

1. **Set thinking display to `summarized`** for the session — via whichever surface §5
   confirms (preferably the `initialize` handshake, so it's set once and rides along
   regardless of in-band `set_model` switches).
2. **Make it survive `set_model`.** The report's theory #3 was that in-band `set_model`
   to Opus 4.8 leaves the warm process in a thinking-disabled state. If display is a
   per-session setting established at `initialize`, this is moot. If it's per-request,
   it must be re-asserted **after every `set_model`** (`subprocess.ts` ~ln 828).
3. **Retire the prompt-prefix hack** (or demote it). `THINK`/`ULTRATHINK` no longer
   controls anything useful on Opus 4.8. If we want a depth control, wire `effort`
   through the settings/flags surface instead — but that's a **separate** enhancement
   from fixing the dark pane and shouldn't block it. Don't conflate them.
4. **Leave the parser alone.** StreamParser is correct; it'll light up the moment
   `thinking_delta` text starts arriving. No webview change is needed for the fix
   itself.

### Instrumentation the report asked for (cheap, do it alongside)

- One host log line per turn: **resolved model** + **whether the thinking block
  produced any text** (sum `thinking_delta` chars at `content_block_stop` for a
  thinking block). Makes the model↔thinking correlation one grep.
- The report also flags that the **webview logs nothing to disk**. Not needed for this
  bug (deltas never leave the host), but a thin webview→host log bridge would make
  future display regressions diagnosable.

---

## 7. Diagnostic sequence (do this before any code change)

This is the report's recommended A/B, sharpened by the display-mode finding:

1. **A/B the model under identical settings.** Switch one turn back to
   `claude-opus-4-6` and confirm `thinkingDelta sent` returns in the logs; switch to
   `claude-opus-4-8` and confirm it goes silent. If 4.6 streams thinking and 4.8 does
   not under the same config, the variable is isolated to the model's **display
   default** — confirming this doc's thesis. (4.6 defaults `summarized`; 4.8 defaults
   `omitted`.)
2. **If §5 finds a display lever:** set it to `summarized`, spawn fresh pinned to 4.8,
   capture one turn, grep for `thinkingDelta sent`. Non-zero = fixed.
3. **If §5 finds *no* CLI display lever:** that's the real finding to escalate — it
   would mean the CLI 2.1.165 doesn't expose summarized thinking for Opus 4.8 over
   stream-json, and the options narrow to (a) pin a model whose default shows thinking,
   or (b) wait for / request a CLI surface. Don't write speculative code against a
   field that doesn't exist.

---

## 8. What NOT to do (anti-fixes)

- ❌ **Don't reach for `set_max_thinking_tokens`.** Wrong dial (budget, not display);
  also removed on 4.8.
- ❌ **Don't escalate the `THINK`/`ULTRATHINK` prefix** hoping more intensity brings
  the pane back. Prompt prefixing cannot change `display` mode.
- ❌ **Don't touch the webview/parser** expecting it to fix the dark pane. The deltas
  never reach the host; there's nothing to render. The fix is upstream, in how
  thinking display is requested.
- ❌ **Don't try to send `thinking: {budget_tokens: N}`** via any path — it 400s on
  Opus 4.8.

---

## 9. One-paragraph handoff

The thinking pane is dark because **Opus 4.8 defaults thinking `display` to
`"omitted"`** (Opus 4.6 defaulted to `"summarized"`), so the model thinks and signs
its thinking but never streams summarized thinking text — the `signature_delta`-with-no-
`thinking_delta` signature in the logs is exactly this. The fix is to put the session
into **`display: "summarized"`** (the curated level the user wants — not raw thinking,
which isn't even a mode), make it survive in-band `set_model`, and retire the obsolete
`THINK`/`ULTRATHINK` prompt-prefix hack. **Budget (`max_thinking_tokens`) is a red
herring** — wrong dial and removed on 4.8. **The single unverified link** is *how the
CLI exposes thinking-display over stream-json* — re-derive it from
`@anthropic-ai/claude-agent-sdk@0.3.165` `sdk.d.ts` — **now done** (§5/§10): the lever
is the **`thinkingDisplay: "summarized"` settings key** (not an `initialize` field),
set in `.claude/settings.local.json` at spawn. Only the live model-turn effect remains
to confirm on an authenticated binary.

---

## 10. Verification log — exactly what was tested

**This is the authoritative evidence trail. Everything in §1–§5 traces back to here.**

- **When:** 2026-06-05. **Where:** an isolated Linux **arm64** sandbox (no Anthropic
  auth), so only the no-model-turn control surface and the binary's static content
  could be exercised. The live model-turn effect (§5 gap) was *not* testable here.
- **Artifacts inspected (installed fresh from public npm, not bundled, not the user's
  install):**
  - `@anthropic-ai/claude-code@2.1.165` → ships per-platform native binaries; the
    matching `@anthropic-ai/claude-code-linux-arm64@2.1.165` provided a **runnable**
    `claude` (ELF aarch64, `--version` → `2.1.165 (Claude Code)`).
  - `@anthropic-ai/claude-agent-sdk@0.3.165` → the SDK's TypeScript view of the control
    protocol (`sdk.d.ts`). CLI patch ↔ SDK patch lockstep (both `165`).
- **Method:** spawned the native binary with `--output-format stream-json
  --input-format stream-json --verbose --permission-prompt-tool stdio` and drove its
  control channel from a Node harness, plus `strings` over the binary.

**What was confirmed (live control channel, returned `success`):**

- `initialize` → response keys `commands, agents, output_style,
  available_output_styles, models, account, pid`. **No thinking/display field on the
  request** (dumped `SDKControlInitializeRequest` in full).
- `get_settings` → `{ effective, sources, applied }`; `applied` shape e.g.
  `{ model: "claude-opus-4-8[1m]", effort: "high", ultracode: false }`.
- `apply_flag_settings { settings: { thinkingDisplay: 'summarized',
  showThinkingSummaries: true, alwaysThinkingEnabled: true } }` → `success`; follow-up
  `get_settings` showed **all three present in `effective`** (but absent from resolved
  `applied` — the §5 gap).
- `set_max_thinking_tokens` with `31999`, `999999999`, `0`, `-5`, `null` → **all
  `success`** (the control request is *accepted*, not rejected — see correction below).

**Binary `strings` — first-party Opus 4.8 migration guide embedded in the executable
(verbatim):**

- "**Thinking content omitted by default.**"
- "``thinking.display`` defaults to `\"omitted\"`; set `\"summarized\"` if you surface
  reasoning to users."
- "Thinking blocks still appear in the response stream on Claude Opus 4.7, but their
  `thinking` field is empty unless you explicitly opt in. This is a silent change from
  Claude Opus 4.6, where the default [was summarized]."
- "`thinking: {type: \"enabled\", budget_tokens: N}` is no longer supported on Claude
  Opus 4.7 or later models and returns a 400 error."
- "`### thinking.display — opt back into summarized reasoning (Opus 4.7)`"
- present as keys: `thinkingDisplay`, `showThinkingSummaries`, `alwaysThinkingEnabled`.

**Correction to §2/§8 (precision, not a reversal):** the *HTTP* `thinking:
{type:'enabled', budget_tokens:N}` path 400s on Opus 4.7+, as those sections say. But
the **`set_max_thinking_tokens` control request is still accepted** by CLI 2.1.165
(returns `success`) — it is **deprecated/coarse** (per `sdk.d.ts`: on adaptive models
it's treated as on/off, any nonzero → adaptive), not "removed." The conclusion is
unchanged: it's the wrong dial for the dark pane. Just don't describe it as rejected.

---

## 11. Model-awareness — the fix is NOT global

**This whole finding is specific to adaptive-thinking models (Opus 4.6+).** The
implementation must branch on model capability, not hard-code the Opus 4.8 path.

- The `initialize` response lists `models: ModelInfo[]`, and `ModelInfo` carries
  **`supportsAdaptiveThinking?: boolean`** — read it to decide which controls apply.
- **Adaptive models (Opus 4.6+):** thinking is `{ type: 'adaptive' }`; *depth* is
  steered by `effort` (`low|medium|high|xhigh`), *visibility* by `display`
  (`omitted|summarized`). Default `display`: **`summarized` on 4.6**, **`omitted` on
  4.7/4.8** — this is the entire bug. `budget_tokens` is invalid here (400).
- **Non-adaptive / older models:** no `display` axis at all; thinking is
  `{ type: 'enabled', budget_tokens: N }` or `{ type: 'disabled' }`. Here the
  legacy budget lever is the relevant one.

So the extension should gate the thinking UI on `supportsAdaptiveThinking`: show the
display/effort controls for adaptive models, and only fall back to a budget/on-off
control for older ones. A single hard-coded `thinkingDisplay: "summarized"` is correct
for the user's pinned `opus-4-8[1m]` today, but should be applied conditionally so it
doesn't misfire if they switch to a non-adaptive model.

### On a "thoughts" slider (omitted → summarized → adaptive): mind the axes

`omitted` and `summarized` are values of **one** axis (`display`). `adaptive` is a
value of a **different** axis (`type`) — it's the *mode under which* both omitted and
summarized exist, not a brighter third display level. There is **no** display level
above `summarized` (raw token-by-token thinking is not a selectable mode on 4.8). So a
3-stop slider `omitted → summarized → adaptive` is a category error.

Two clean options instead:

- **A 2-stop "Show thoughts" toggle** mapping to `display: omitted | summarized`
  (the literal fix for the dark pane).
- **If a 3-stop "thinking effort" slider is wanted, it's the `effort` axis**
  (`low/medium/high/xhigh`), orthogonal to display. Depth and visibility are separate
  product controls; combining them into one slider will confuse both.

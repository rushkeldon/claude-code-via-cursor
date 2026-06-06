# Thoughts (Extended Thinking) Report — why the thinking pane went dark

Status: **investigation / leading theories** (no fix applied yet)
Author: drafted 2026-06-05 from on-disk log analysis
Logs read: `~/Library/Application Support/claude-code-via-cursor/Logs/claude-code-via-cursor-2026-06-0{3,4,5}.log`
Code refs: `src/subprocess.ts` (StreamParser), `src/webview/components/ThinkingPane`, `ThinkingPill`

---

## The problem

In Cursor, watching Claude's internal thinking stream live is invaluable and a
hard requirement for this extension. It **used to work** here and now does not —
the thinking pane is dark. The hypothesis going in was "the thoughts are still
being sent, we're just not detecting/displaying them." The logs largely confirm
the *spirit* of that hypothesis but relocate the failure: **the thinking text is
no longer arriving in the CLI's stream at all** for the model we're pinned to,
even though the thinking *block envelope* (start + signature) still arrives.

## What the logs actually show

The extension host logs every level to disk (no suppression — see
`src/logger.ts`), so the StreamParser traces are complete. Three event types
matter, all emitted from `processJsonStreamData` in `src/subprocess.ts`:

- `thinkingBlockStart sent` — a `content_block_start` with `blockType="thinking"`
  (subprocess.ts:1091–1093).
- `thinkingDelta sent` — a `content_block_delta` of type `thinking_delta`, i.e.
  the **actual streamed thought text** (subprocess.ts:1097–1101).
- `unknown content_block_delta type … deltaType="signature_delta"` — the
  thinking block's closing cryptographic signature (subprocess.ts:1107).

### Counts across the last three days

| Day | `thinkingDelta sent` (thought TEXT) | `thinkingBlockStart` (block opens) | `signature_delta` (block closes) | final `type="thinking"` saves |
|-----|------:|------:|------:|------:|
| Jun 03 | **6239** | 79 | 79 | 83 |
| Jun 04 | **5034** | 311 | 303 | 74 |
| Jun 05 | **226** | 173 | 166 | **2** |

Thinking **blocks** keep opening and closing every day (the envelope is healthy).
But the streamed thought **text** (`thinkingDelta`) collapses from thousands/day
to 226 on Jun 5 — and those 226 are all clustered before **00:36:17**, after
which there are **zero** for the rest of the day.

### The break point correlates with a model switch

On the **same warm process** (`pid=62480`), in-band `set_model` calls bracket the
cutover:

```
00:34:43  set_model ok model="haiku"
00:36:17  thinkingDelta sent …" a straightforward answer."   ← LAST thought text ever
00:36:48  set_model ok model="us.anthropic.claude-opus-4-8"  ← pinned [1m] model
…after this, every thinking block is start + signature_delta only, no text…
```

The last day thinking text fully worked (Jun 4, pid 12133/41985) the resolved
model was **Opus 4.6** (`thinkingDelta … "by Claude Opus 4.6 (model ID:
us.anthropic.claude-opus-4-6-v1)"`). The text stopped the moment the session
moved to **`us.anthropic.claude-opus-4-8`** and never returned across **eight
later version bumps and several respawns** (appcloud9.70 → .76).

### A representative BROKEN thinking block (Jun 5, 04:37, pid 64999)

```
content_block_start blockType="thinking" index=0
thinkingBlockStart sent
unknown content_block_delta type deltaType="signature_delta"   ← straight to signature
streamData type="assistant"                                    ← no thinking_delta in between
content_block_start blockType="text" index=1
```

The block opens, emits **only** a `signature_delta`, and closes. No
`thinking_delta` chunk is ever delivered. Compare a healthy block (Jun 4): the
`content_block_start blockType="thinking"` is followed by dozens of
`thinking_delta sent` lines, *then* the `signature_delta`.

### Block types seen across all three days

```
1657 "text"
 564 "thinking"
2332 "tool_use"
```

No `redacted_thinking` blocks at all — so this is **not** a redaction/encryption
case where the body is deliberately withheld as `redacted_thinking`. The block is
declared `thinking`, opens, and simply carries no text deltas.

## What is NOT the cause (ruled out by logs)

- **Not the webview render layer being broken.** The host is still posting
  `thinkingBlockStart`. The reason the pane is dark is that **no `thinkingDelta`
  follows** — there is nothing to render. (Caveat: the webview has *zero* file
  logging, so we cannot positively confirm the webview's behavior from logs. See
  "Blind spot" below.)
- **Not `--include-partial-messages` being dropped.** It is hardcoded in
  `spawnProcess` args and unchanged; partial messages (the `stream_event` deltas)
  are clearly still flowing — text and tool_use deltas stream fine; only
  `thinking_delta` is absent.
- **Not a parser regression on our side.** subprocess.ts:1097–1101 still handles
  `thinking_delta` exactly as before; the logs show it simply isn't being
  *received*. (The "unknown delta type" warning for `signature_delta` is benign
  noise — it predates the break and fires on healthy days too.)
- **Not a one-off.** It persisted across many respawns and 8 version bumps, so
  it's tied to persistent state (the model / its settings), not a transient
  process glitch.

## Leading theories (ranked)

### 1. Opus 4.8 `[1m]` is running with thinking effectively OFF / non-streamed (most likely)

The break is *exactly* coincident with switching to
`us.anthropic.claude-opus-4-8` (the pinned `[1m]` model). The block envelope
appears because the model still allocates a thinking block, but no streamed
`thinking_delta` text is produced. Most probable mechanisms:

- The CLI's request for opus-4-8 is sent with **no (or zero-budget) thinking
  config**, or with thinking in a non-streamed mode, so the API returns an empty
  thinking block + signature. Recall the extension deliberately does **not** pass
  `--model`; the model is resolved through `.claude/settings.local.json` and an
  in-band `set_model`. If thinking budget/headers don't ride along with that
  in-band switch, opus-4-8 turns can run effectively thinking-disabled.
- This also explains the **2** final `type="thinking"` saves on Jun 5 vs 74–83
  on prior days: the non-streamed thinking path
  (`content.type === 'thinking'` in the full `assistant` message,
  subprocess.ts:1200) is also nearly empty — consistent with the model producing
  no thinking content, rather than the content being streamed-but-dropped.

### 2. The Bedrock `[1m]` model id / provider doesn't surface thinking deltas the way 4.6 did

The last fully-working thinking ran on **Opus 4.6**; the break is on the Bedrock
`us.anthropic.claude-opus-4-8` id. A provider/model-version difference in how (or
whether) interleaved thinking is streamed back over `stream-json` would produce
exactly this signature: block declared, signature emitted, no text deltas. This
is provider-shaped rather than our-bug-shaped.

### 3. `set_model` mid-session leaves the warm process in a thinking-disabled state

Every post-break turn reused warm process `pid=62480` (then later respawns). It's
possible the in-band `set_model` to opus-4-8 doesn't re-establish thinking
parameters that a *fresh spawn with the right settings* would. If a clean spawn
already pinned to opus-4-8 (no haiku detour, no in-band switch) streams thinking
correctly, this is the cause. The logs can't distinguish this from #1 because we
never spawned fresh on opus-4-8 with thinking known-good after the break.

## Blind spot the logs exposed (instrumentation gap)

The **webview logs nothing to disk** — `ThinkingPane`/`ThinkingPill` and the
`on('thinkingDelta')` / `on('thinkingBlockStart')` listeners are invisible to the
log file. For *this* bug it doesn't matter (the deltas never leave the host), but
to make future thinking-display regressions diagnosable we should add a thin
bridge that lets the webview post structured log lines back to the host logger,
or at least count-and-report deltas received vs rendered.

We are otherwise **not** instrumentation-starved on the host: the StreamParser
traces were sufficient to localize this precisely. The one host-side addition
worth making is a single log line capturing, per turn, the **resolved model** and
**whether a thinking block produced any text** (e.g. `thinkingTextChars` summed
at `content_block_stop` for a thinking block), so the model↔thinking correlation
is one grep instead of a cross-reference.

## Recommended next steps (diagnostic, before any code change)

1. **Spawn fresh, pinned to opus-4-8, thinking toggle ON, and capture one turn.**
   Grep the new log for `thinkingDelta sent`. If still zero, theory #1/#2 (model
   produces no streamed thinking); if non-zero, theory #3 (in-band `set_model`
   state).
2. **A/B the model.** Switch back to `claude-opus-4-6` for one turn and confirm
   `thinkingDelta` returns. If 4.6 streams and 4.8 doesn't under identical
   settings, the variable is isolated to the model/its thinking config.
3. **Inspect how thinking budget/headers are (or aren't) attached** for the
   resolved opus-4-8 path — both at spawn (settings.local.json) and on the in-band
   `set_model` control request. This is where a real fix would land if #1 holds.
4. **Add the two log lines above** (resolved model + per-turn thinking text char
   count) so the correlation is self-evident in the next capture.

## One-line summary

The thinking **pane** isn't broken — the thinking **text stopped arriving from
the CLI** the instant the session pinned to `us.anthropic.claude-opus-4-8`; every
thinking block since opens and closes with only a `signature_delta` and no
`thinking_delta`, so there is nothing for the pane to show. The fix almost
certainly lives in how thinking is requested/configured for the opus-4-8 path,
not in the webview.

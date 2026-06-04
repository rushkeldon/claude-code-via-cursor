# Thinking pane — protocol reference

This is a debugging spec for the thinking pane in the Preact webview, written because Claude Code keeps guessing at causes instead of checking specific points in the pipeline. Read this top to bottom before forming a hypothesis.

## Tl;dr

The thinking pane requires three things to work:

1. The `claude` CLI subprocess must emit `stream_event` messages with `content_block_delta` events whose `delta.type === 'thinking_delta'`.
2. The extension's `subprocess.ts` must detect those events and post `{ type: 'thinkingDelta', data: <chunk> }` to the webview.
3. The webview must listen for `thinkingDelta`, update a reactive store, and the `ThinkingPane` component must read that store and render.

If any link is broken, the thinking pane stays empty. **Before guessing about which link is broken, check the log file for evidence of each step.**

The OLD repo at `~/Desktop/working/claude-code-chat/` has a working reference implementation in `src/script.ts`. When stuck, read it.

## Common wrong guesses (don't go here without evidence)

- **"Claude Code stopped producing thinking blocks for this conversation."** No. Plan mode + Ultrathink reliably trigger extended thinking. If thinking blocks weren't being produced, you'd see no thinking in the OLD extension either, and you do. The CLI subprocess emits the same stream regardless of which webview is reading it.
- **"Maybe the model decided this was too simple a query for thinking."** This is a fig leaf. Verify with the log first — if you see `thinkingDelta sent` lines, deltas ARE arriving. If you don't, the issue is upstream of the webview.
- **"--resume is suppressing thinking."** No. `--resume` resumes a session id; it doesn't disable extended thinking.

## The protocol — what flows on which pipe

### Extension → `claude` subprocess (via stdin, stream-json)

The extension spawns `claude` with these flags (see `src/subprocess.ts`):

```
claude --output-format stream-json
       --input-format stream-json
       --include-partial-messages    ← REQUIRED for token-level deltas
       --verbose
       --permission-prompt-tool stdio
       [--model <id>] [--resume <session-id>] [--permission-mode plan]
```

User messages are written to the subprocess's stdin as JSON lines:

```json
{"type": "user", "session_id": "...", "message": {"role": "user", "content": [{"type": "text", "text": "..."}]}, "parent_tool_use_id": null}
```

### `claude` subprocess → Extension (via stdout, stream-json)

Each line is one JSON object. The relevant types for thinking:

**`{type: "stream_event", event: {...}}`** — wraps Anthropic streaming-API events. Subtypes by `event.type`:

- `message_start` — assistant turn begins
- `content_block_start` — a content block begins. The block carries its own `type`:
  - `event.content_block.type === "thinking"` — a thinking block is starting
  - `event.content_block.type === "text"` — a text block is starting
  - `event.content_block.type === "tool_use"` — a tool call is starting
- `content_block_delta` — incremental update to the current content block:
  - `event.delta.type === "thinking_delta"` with `event.delta.thinking === "<chunk>"` — token of thinking
  - `event.delta.type === "text_delta"` with `event.delta.text === "<chunk>"` — token of response text
  - `event.delta.type === "input_json_delta"` — token of tool argument JSON
- `content_block_stop` — block complete
- `message_delta` — usage / stop_reason update
- `message_stop` — turn complete

**`{type: "system", subtype: "thinking_tokens"}`** — paired with deltas during thinking, reports running token count. Not load-bearing for rendering; safe to skip if it's noisy.

**`{type: "assistant", message: {content: [...], usage: {...}}}`** — the FULL assembled assistant message, sent ONCE per assistant turn after all blocks complete. Contains:
- `content[]` array of `{type: "thinking", thinking: "<full text>"}` and/or `{type: "text", text: "<full text>"}` and/or `{type: "tool_use", ...}` blocks
- `usage: {input_tokens, output_tokens, cache_*}`
- This is a CONVENIENCE event — the same content was already sent via stream_event deltas. **It arrives even when you've already seen the deltas.** You need to dedupe.

**`{type: "result", subtype: "success" | "error", session_id, ...}`** — turn complete; subprocess will write next user input after this.

### Extension → Webview (via `webview.postMessage`)

The extension's `subprocess.ts` translates the wire-level events above into these webview-facing message types. **THESE are what the webview needs to listen for.**

| Webview message type | Fires when | Payload | Source in subprocess.ts |
|---|---|---|---|
| `thinkingBlockStart` | A `stream_event` with `event.type === "content_block_start"` and `event.content_block.type === "thinking"` | `{ type: 'thinkingBlockStart' }` | Inside the `case 'stream_event':` branch |
| `thinkingDelta` | A `stream_event` with `event.type === "content_block_delta"` and `event.delta.type === "thinking_delta"` | `{ type: 'thinkingDelta', data: <chunk-string> }` | Inside the `case 'stream_event':` branch |
| `thinking` | An `assistant` message arrives containing a `{type: 'thinking', thinking: '...'}` content block | `{ type: 'thinking', data: <full-thinking-string> }` | Inside the `case 'assistant':` branch |
| `output` | An `assistant` message arrives containing a `{type: 'text', text: '...'}` content block | `{ type: 'output', data: <full-text-string> }` | Inside the `case 'assistant':` branch |
| `setProcessing` | Subprocess process closes (turn ended) | `{ type: 'setProcessing', data: { isProcessing: false } }` | The `claudeProcess.on('close', ...)` handler |

**Critical dedup detail:** `thinking` (assembled) ALWAYS fires after a thinking block, regardless of whether `thinkingDelta` already streamed the same content. If the webview appends both, you'll render the thinking content twice.

The OLD repo handles this with a per-turn flag (`thinkingStreamedThisTurn`):
- Reset to `false` at the start of each user send.
- Set to `true` the first time a `thinkingDelta` arrives.
- When a `thinking` (assembled) message arrives, check the flag. If `true`, skip the append — deltas already covered the content. If `false`, append the assembled chunk as a fallback (means deltas didn't arrive for this turn, e.g., older Claude version without `--include-partial-messages`).

## What the new Preact webview must implement

### `src/webview/vscode.ts` — message bus types

Add these to `MessageFromExtension`:

```ts
| { type: 'thinkingBlockStart' }
| { type: 'thinkingDelta'; data: string }
| { type: 'thinking'; data: string }
```

### `src/webview/state/thinking.ts` (or wherever thinking state lives)

```ts
import { signal } from '@preact/signals';
import { on } from '../vscode';

// Live, streaming thinking text. Accumulates as deltas arrive.
export const thinkingContent = signal<string>('');
// Whether a thinking pane is actively streaming (used by ThinkingPane to render).
export const thinkingActive = signal<boolean>(false);
// Per-turn flag — set on first delta, checked when 'thinking' (assembled) arrives.
let thinkingStreamedThisTurn = false;

// Called from MessageInput's send action.
export function resetThinkingForNewTurn(): void {
  thinkingContent.value = '';
  thinkingActive.value = false;
  thinkingStreamedThisTurn = false;
}

on('thinkingBlockStart', () => {
  // Multi-block thinking: insert a separator between blocks.
  // If this is the first block of the turn, just mark active.
  if (thinkingActive.value && thinkingContent.value.length > 0) {
    thinkingContent.value += '\n\n';
  } else {
    thinkingActive.value = true;
  }
});

on('thinkingDelta', (msg) => {
  thinkingStreamedThisTurn = true;
  thinkingActive.value = true;
  thinkingContent.value += msg.data;
});

on('thinking', (msg) => {
  if (thinkingStreamedThisTurn) {
    // Deltas already covered it — skip the assembled echo.
    return;
  }
  // Fallback: deltas didn't arrive (older Claude CLI, or --include-partial-messages stripped).
  thinkingActive.value = true;
  thinkingContent.value += msg.data;
});

on('output', () => {
  // First text token of the response — the thinking phase is done.
  // ThinkingPane should collapse to a pill at this point.
  // (Implementation of collapse animation is the ThinkingPane component's concern.)
});

on('setProcessing', (msg) => {
  if (!msg.data.isProcessing) {
    // Turn complete. If thinking pane is still expanded (no output arrived),
    // collapse it now.
    thinkingActive.value = false;
  }
});
```

### `src/webview/components/ThinkingPane/ThinkingPane.tsx`

```tsx
import './ThinkingPane.less';
import { thinkingContent, thinkingActive } from '../../state/thinking';

export function ThinkingPane() {
  if (!thinkingActive.value) return null;
  return (
    <div class="thinking-pane">
      <div class="thinking-pane-header">💭 Thinking…</div>
      <div class="thinking-pane-content">{thinkingContent.value}</div>
    </div>
  );
}
```

(Module-level state for `thinkingStreamedThisTurn` is intentional — it's a per-turn flag that doesn't need to be reactive, just remembered between event handlers within a turn.)

## Debugging checklist — in order

When the thinking pane isn't populating, walk this list. **Don't skip steps.**

### 1. Is the extension receiving thinking_delta events from the CLI?

```bash
LOG="$HOME/Library/Application Support/claude-code-via-cursor/Logs/claude-code-via-cursor-$(date -u +%Y-%m-%d).log"
grep "thinkingDelta sent" "$LOG" | tail -10
```

Expected: ~17+ lines per turn that exercises thinking, like:
```
🧠 DEBUG [pid=NNNNN StreamParser] thinkingDelta sent chunkLen=3 chunkSnippet="The"
🧠 DEBUG [pid=NNNNN StreamParser] thinkingDelta sent chunkLen=11 chunkSnippet=" user seems"
```

If you see these, the extension IS posting `thinkingDelta` messages to the webview. The bug is webview-side.
If you don't see these, the bug is in `subprocess.ts` (or further upstream).

### 2. Is `subprocess.ts` actually invoking the stream_event handler?

```bash
grep "streamData type=\"stream_event\"" "$LOG" | tail -5
```

Expected output every turn that has thinking. If absent, `--include-partial-messages` isn't being passed (check the args array in `subprocess.ts`).

### 3. Is the webview's `thinkingDelta` handler registered?

Open Cursor's Webview DevTools (Cmd+Shift+P → "Developer: Open Webview Developer Tools"). In the Console, evaluate (assuming you've exposed the listeners for debugging):

```js
// If you've added a window.__debug_listeners hook in vscode.ts:
window.__debug_listeners?.get('thinkingDelta')?.length
// Should be at least 1.
```

If 0 or undefined, the state file isn't being imported (dead-code-eliminated by Vite?), or the `on('thinkingDelta', ...)` registration isn't running.

### 4. Are the events arriving in the webview but being silently dropped?

In Webview DevTools Console:

```js
// One-time trap: log every message arriving at the webview
window.addEventListener('message', (e) => console.log('[webview msg]', e.data?.type, e.data));
```

Then send a prompt that exercises thinking (Ultrathink toggled on, or any Plan-mode prompt). You should see:
```
[webview msg] thinkingBlockStart {...}
[webview msg] thinkingDelta { type: 'thinkingDelta', data: 'The' }
[webview msg] thinkingDelta { type: 'thinkingDelta', data: ' user seems' }
...
[webview msg] thinking { type: 'thinking', data: '<full thinking>' }
[webview msg] output { type: 'output', data: '<response text>' }
```

If you see them but the pane doesn't update, the state-store handler isn't firing OR the signal isn't being read by ThinkingPane.

### 5. Is the signal updating but the component not reading it?

In Webview DevTools Console (assuming a debug hook on the signal):

```js
window.__debug_thinking.value
```

Should reflect the accumulated thinking text. If it does but the pane stays empty, ThinkingPane isn't reading `.value` correctly — likely reading it outside a reactive context (e.g., in a `useEffect`'s closure without `value` access at render time).

## Last-resort sanity check

If all of 1-5 look right and thinking still isn't rendering, install the OLD extension (`cursor --install-extension /Users/keldon/Desktop/working/claude-code-chat/claude-code-via-cursor-2.0.9-appcloud9.33.vsix --force`), send the same prompt with the same `setClaudeTo` profile, and verify thinking renders there. If it does (it will), the CLI subprocess is fine and the bug is 100% in the new repo's webview side. Re-install the new VSIX and continue with debugging steps 3-5.

## OLD repo reference implementation

For exact behavior to match, read these sections of the OLD repo:

- `~/Desktop/working/claude-code-chat/src/subprocess.ts` — the `case 'stream_event':` and `case 'assistant':` branches inside `_processJsonStreamData`. The extension-side translation logic.
- `~/Desktop/working/claude-code-chat/src/script.ts` — search for `case 'thinkingDelta':`, `case 'thinking':`, `appendThinkingDelta`, `thinkingStreamedThisTurn`. The webview-side handling logic.
- `~/Desktop/working/claude-code-chat/src/ui-styles.css` — search for `.thinking-live`, `.thinking-pill`, `.thinking-chunk-sep`. The styling reference.

Don't copy the JS verbatim — the new repo's signal-based pattern is cleaner. But the behavioral semantics (when to dedupe, when to collapse, when to insert paragraph breaks for multi-block thinking) should match exactly.

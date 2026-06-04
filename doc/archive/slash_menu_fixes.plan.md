---
name: Slash Menu Bug Fixes
overview: >
  Fix three bugs with the slash command menu: slow command list fetch, inadequate height,
  and difficult exit behavior. Replace the headless `claude --print` spawn with a silent
  query to the already-running subprocess.
todos:
  - id: silent-query
    content: "Replace headless claude --print with a silent query sent to the running subprocess — intercept the response in the extension host without forwarding to the webview"
    status: pending
  - id: cache-in-globalstate
    content: "Cache the command list in globalState so subsequent sessions load instantly; re-fetch silently on session start and on / activation"
    status: pending
  - id: fix-height
    content: "Remove the fixed max-height on CommandAutocomplete; let it fill available space above the prompt up to the top of the viewport"
    status: pending
  - id: fix-exit-behavior
    content: "Add exit triggers: slash button toggles, backspace past / exits, input not starting with / exits"
    status: pending
  - id: verify-build
    content: "Build, install, test: fast menu appearance, full height, all exit methods work"
    status: pending
isProject: false
---

# Slash Menu Bug Fixes

## Background

Three bugs reported:
1. The command list takes 10-30 seconds to appear because we spawn a new `claude --print` instance
2. The autocomplete dropdown is capped at 240px height — not enough for the full list
3. Exiting terminal mode is difficult — only Escape works currently

## Why the silent query approach is much faster

**Current approach (slow):**
- `claude --print "list commands..."` spawns an entirely new Claude Code process
- That process must: initialize, read config, authenticate, load system prompt, send to API, wait for response, parse, exit
- Wall clock: 10-30 seconds depending on network/API latency

**New approach (fast):**
- The subprocess is already running, authenticated, warmed up, with context loaded
- We write a JSON message to its stdin (instant)
- It processes it as a normal turn — but the response comes back in 1-3 seconds (no cold start)
- The extension host intercepts the response before it reaches the webview — user sees nothing
- Result is cached in `globalState` — next time it's instant (0ms, already in memory)

The difference is cold start (10-30s) vs hot path (1-3s) vs cached (0ms).

## Approach

### Silent query mechanism

Add a `silentQueryInFlight` flag to the subprocess/webview bridge. When set:
- The user's message (asking for command list) is sent to stdin but NOT shown in the webview chat
- The subprocess response is intercepted in the JSONL parser, NOT forwarded as an `output` message
- Instead, the response is parsed for the JSON command list and sent as a `commandList` message
- The flag is cleared after the response arrives

Trigger: at session start (once subprocess is ready) and on `/` button click.

### Caching

- After a successful fetch, store the parsed list in `globalState.update('cachedCommandList', list)`
- On extension activation, immediately load from cache and send to webview
- Background fetch updates the cache silently

### Height fix

Remove `max-height: 240px` from `.command-autocomplete`. Replace with:
```css
max-height: calc(100vh - 150px);
```
This fills upward from the prompt to near the top of the viewport. The 150px reserves space for the prompt + controls + status bar.

### Exit behavior

In `PromptPane.tsx` `handleInput`:
- If textarea value doesn't start with `/` and `terminalMode` is active → exit
- If textarea value is empty and `terminalMode` is active → exit

In the `/` button onClick:
- If `terminalMode` is already active → call `exitTerminalMode()` (toggle behavior)

## Files to modify

- [src/webview.ts](src/webview.ts) — add `silentQueryInFlight` flag, intercept response, cache in globalState
- [src/subprocess.ts](src/subprocess.ts) — may need to expose a way to send without triggering the normal conversation flow
- [src/webview/components/CommandAutocomplete/CommandAutocomplete.less](src/webview/components/CommandAutocomplete/CommandAutocomplete.less) — fix max-height
- [src/webview/components/PromptPane/PromptPane.tsx](src/webview/components/PromptPane/PromptPane.tsx) — fix exit triggers, toggle slash button

## Edge cases

- **Subprocess not ready yet**: if the user clicks `/` before the subprocess has started, fall back to cached list only (no fetch attempt)
- **Silent query response takes too long**: set a 10-second timeout; if exceeded, just show cached list
- **Response isn't valid JSON**: fall back to cached list, log error
- **User sends a message while silent query is in flight**: tricky — probably need to queue or cancel the silent query. Safest: only send the silent query when the subprocess is idle (not processing a user request)

## What we are NOT doing

- Hardcoded fallback lists — cache only
- `claude plugin list` as a separate process — using the running instance instead
- Changing the prompt the silent query sends (keeping it as "list all slash commands as JSON")

## Open questions

- Is `/compact` in Claude Code's slash command list? It should be — it's a built-in. The query to Claude will include it if it exists. We're not filtering anything.

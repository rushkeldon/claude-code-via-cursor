---
name: Browser CLI — a from-scratch CDP bridge so Claude Code can drive a real browser
overview: >
  Build a standalone `browser` CLI (its own software project) that drives Chrome
  over the Chrome DevTools Protocol, exposed to Claude Code via Bash + a Skill —
  no MCP. Two modes: Sandboxed (fresh throwaway Chrome for integration tests) and
  Live (a dedicated, logged-in automation profile for authoring in authenticated
  web apps like Confluence). CCVC launches/manages the browser the same way it
  already manages the `claude` subprocess.
todos:
  - id: cdp-client
    content: "Build the CDP client core — one WebSocket, id↔reply correlation, event bus, domain enable, reconnect"
    status: pending
  - id: launch-manager
    content: "Build the launch/profile manager for Sandboxed (temp profile) and Live (dedicated logged-in profile) modes — includes the one OS-specific seam: findChrome() + per-platform profile paths (Mac/Linux/Windows)"
    status: pending
  - id: action-core
    content: "Build the action core — resolve-node-now + wait-until-actionable + frame/target selection + real input dispatch"
    status: pending
  - id: perceive
    content: "Build the perceive layer — accessibility-tree snapshot with stable refs Claude names in subsequent actions"
    status: pending
  - id: verb-cli
    content: "Build the verb layer / CLI surface (navigate, snapshot, click, type, wait, eval) with JSON stdout"
    status: pending
  - id: skill
    content: "Write the Claude Code Skill that documents the verb surface once (the declare-API-once moment)"
    status: pending
  - id: ccvc-integration
    content: "Wire CCVC to launch/manage the browser process and expose a Sandboxed/Live mode toggle"
    status: pending
  - id: harden
    content: "Hardening pass — SPA navigation readiness, iframe targets, stale-node retries, timeouts; test against a real Confluence page and a localhost app"
    status: pending
isProject: true
---

# Browser CLI — a from-scratch CDP bridge for Claude Code

## Background

We want Claude Code — driven from this extension (CCVC) — to be able to act in a
web browser, the way Claude Desktop's cowork bridges to the Claude Chrome
extension. We reverse-engineered Desktop's mechanism (see
[doc/Claude_Chrome_extension.md](Claude_Chrome_extension.md)): a Chrome native
messaging host relays `ToolRequest{method, params}` over a unix socket to the
Electron app, which exposes the browser as internal tools bound to an
Anthropic-brokered session. We are **not** reusing that — it rides Anthropic auth
and is off-limits per our compliance guardrails. Instead we build our own bridge
with Claude Code as the brain.

Two concrete jobs motivate this, and they pull in opposite directions on one
axis — *whose browser session*:

- **Integration testing / verifying a just-built feature** wants a *clean,
  disposable* browser. Your logged-in state would be a contaminant.
- **Authoring in an authenticated web app** (the motivating example: editing a
  runbook directly in Confluence instead of a local Markdown file) wants the
  *opposite* — your real, logged-in session is the whole point.

These become the two modes: **Sandboxed** and **Live**.

### Decisions already made (don't re-litigate)

- **No MCP.** MCP's per-turn tool-schema declarations are resident in context
  every turn (caching helps latency/$, not context budget) and the spec is
  verbose. We want the "declare the API surface once, then fire" shape (cf. a
  Gemini Live websocket session). The CLI+Skill pattern achieves that token
  profile: the only resident tool is Bash; the verb surface lives in a Skill
  loaded once when relevant.
- **CLI-driven, via Bash.** Claude Code runs `browser <verb> <args>` and reads
  JSON from stdout. Transparent (you can run the same command yourself),
  git-able, no server lifecycle.
- **From scratch over CDP** — not a Playwright wrapper. This is its own software
  project. We accept that we re-solve the reliability gotchas Playwright gives
  for free, in exchange for owning the whole stack. Scope is tractable because
  we target two named jobs, not "every site for everyone."
- **DOM/accessibility-first, not vision.** CDP gives structured page state, so
  Claude acts on element refs, not pixel coordinates. Vision is not in scope.
- **Mode names are final: `Sandboxed` and `Live`.** UI tooltip for Live carries
  the precision ("drives your real logged-in browser").

## Approach

The design is **perceive, then act**. Claude Code calls `browser snapshot` to get
a clean accessibility-tree view of the page (roles, names, and a stable `ref` per
node), reasons about it, then calls `browser click <ref>` / `browser type <ref>
<text>`. Pairing perception with action and re-resolving the node at action time
sidesteps most CDP node-identity churn.

Four layers, bottom-up. Each maps to a todo.

1. **CDP client core** (`cdp-client`) — the only genuinely fiddly piece, and the
   one your websocket experience transfers to directly. One WebSocket to Chrome's
   `--remote-debugging-port`. CDP multiplexes request/response *and* an event
   firehose on that socket, so: a `{id → pending promise}` map to correlate
   command replies, an event emitter for async events, per-domain `enable` calls
   (`Page`, `DOM`, `Runtime`, `Input`, `Target`, `Accessibility`), and reconnect
   logic. Commands are `{id, method, params}`; replies are `{id, result|error}`.

2. **Launch / profile manager** (`launch-manager`) — owns the Sandboxed↔Live
   distinction, the only place the two modes differ:
   - **Sandboxed:** launch Chrome with a throwaway `--user-data-dir` (temp), the
     debug port, optionally headed (so you can *watch* a test) or headless. Drive,
     then kill and delete the temp dir. Stateless and reproducible.
   - **Live:** connect to (or launch) Chrome against a **dedicated automation
     profile** at a fixed `--user-data-dir` (e.g. `~/.ccvc-browser-profile`) with
     the debug port. You log into Confluence (etc.) *in that profile once*; the
     session persists across runs. **This is required, not a preference:** since
     Chrome 136, `--remote-debugging-port` is ignored against the *default*
     profile dir (an anti-cookie-theft change), so a separate `--user-data-dir`
     is mandatory. Bonus: your everyday browsing profile is never exposed to
     automation.

3. **Action core** (`action-core`) — the reliability layer; ~70% of the real
   effort lives here and in frame handling. One spine: `resolveAndAct(intent)`:
   - **Resolve the node *now*** from the `ref` the snapshot handed out (refs are
     backed by `backendNodeId`, which survives front-end churn better than
     `nodeId`). Never reuse a stale handle — re-resolve every action.
   - **Wait-until-actionable** — poll until attached, visible, stable (bounding
     box unchanged across two frames), and hittable (not covered), or time out.
     One opinionated strategy applied everywhere, vs. Playwright's matrix.
   - **Pick the right frame/target** — iframes and tabs are separate CDP targets
     with their own sessions (Confluence's editor is commonly an iframe). Attach
     to the correct target before acting.
   - **Dispatch *real* input** — `Input.dispatchMouseEvent`
     (`mousePressed`→`mouseReleased`, with `clickCount`) at coordinates from
     `DOM.getContentQuads` (viewport-relative; **use this, not `getBoxModel`**);
     `Input.dispatchKeyEvent` / `Input.insertText` for typing into rich editors.
     Synthetic DOM events silently fail to trigger many site handlers.

4. **Perceive layer** (`perceive`) — `Accessibility.getFullAXTree` returns
   `AXNode`s with `role`, `name`, and `backendDOMNodeId`. Flatten to a compact,
   token-cheap list Claude can read, assigning each actionable node a short
   stable `ref` (e.g. `e7`) mapped to its `backendNodeId` for the action core.
   This is the contract between "what Claude sees" and "what CDP touches."

5. **Verb layer + CLI** (`verb-cli`) and **Skill** (`skill`) — the thin top.
   Verbs: `navigate <url>`, `snapshot`, `click <ref>`, `type <ref> <text>`,
   `wait <condition>`, `eval <js>` (escape hatch), plus a `--mode sandboxed|live`
   flag. JSON on stdout. The Skill documents this surface **once** — the
   "declare the API once" moment — so Claude knows the verbs without a per-turn
   schema tax.

6. **CCVC integration** (`ccvc-integration`) — CCVC launches and manages the
   browser process exactly as it manages the `claude` subprocess today (spawn,
   track, restart), and surfaces the **Sandboxed / Live** toggle in the webview.
   Per compliance guardrails this stays a launcher: per-turn, human-in-the-loop,
   no auth surface, no autonomous loop.

## Files to modify / create

This is a new standalone project; exact home TBD (sibling repo vs. a subfolder
shipped with CCVC). Indicative layout:

- `browser-cli/src/cdp/client.ts` — WebSocket CDP client (commands, events, reconnect)
- `browser-cli/src/cdp/targets.ts` — target/frame/session management
- `browser-cli/src/launch/profiles.ts` — Sandboxed vs Live launch + profile mgmt; the one OS-specific seam (`findChrome()` + per-platform profile paths)
- `browser-cli/src/action/resolve.ts` — node resolution from refs (backendNodeId)
- `browser-cli/src/action/actionable.ts` — wait-until-actionable polling
- `browser-cli/src/action/input.ts` — real mouse/key dispatch via Input domain
- `browser-cli/src/perceive/snapshot.ts` — AX-tree → compact ref'd snapshot
- `browser-cli/src/cli.ts` — verb parsing, `--mode`, JSON stdout
- `.claude/skills/browser/SKILL.md` — documents the verb surface for Claude Code
- [src/subprocess.ts](../src/subprocess.ts) — CCVC: spawn/track the browser process (mirror the `claude` lifecycle)
- [src/webview.ts](../src/webview.ts) — CCVC: route a `setBrowserMode` message
- `src/webview/components/…` — CCVC: the Sandboxed/Live toggle UI

## Implementation details

### Verified CDP surface (checked against chromedevtools.github.io, 2026-06)

- **Input:** `Input.dispatchMouseEvent` (types `mousePressed` / `mouseReleased` /
  `mouseMoved` / `mouseWheel`; params x, y, button, clickCount).
  `Input.dispatchKeyEvent` (types `keyDown` / `keyUp` / `rawKeyDown` / `char`).
  `Input.insertText` (IME-style text insertion for rich editors). ✓
- **DOM:** `DOM.getDocument`, `DOM.querySelector`, `DOM.describeNode`,
  `DOM.resolveNode`, `DOM.getContentQuads` (**preferred for click coords** —
  viewport-relative quads), `DOM.getBoxModel` (dimensions, not click coords).
  Identifiers: `nodeId` (front-end, churns), `backendNodeId` (stable across
  front-end pushes — what refs map to), `objectId` (JS remote object). ✓
- **Accessibility:** `Accessibility.getFullAXTree` → `AXNode[]` with `role`,
  `name`, `backendDOMNodeId`, `childIds`; requires `Accessibility.enable()`
  first to keep node ids consistent. ✓
- **Page / Target:** lifecycle events (`load`, `DOMContentLoaded`,
  `Page.frameNavigated`) and `Target.*` for tabs/iframes — to be cited precisely
  during the `cdp-client` and `harden` todos.

### Sandboxed launch (sketch)

```
chrome --remote-debugging-port=<p> --user-data-dir=<tmp> [--headless=new] <url>
# drive over ws://127.0.0.1:<p>/...   then kill + rm -rf <tmp>
```

### Live launch (sketch)

```
chrome --remote-debugging-port=<p> --user-data-dir=~/.ccvc-browser-profile
# first run: user logs into Confluence in that window once; persists thereafter
```

### Portability (Mac / Linux / Windows)

The CLI is **portable by construction.** CDP is identical across all three OSes
(it's the browser's protocol, not the platform's), and Node runs everywhere — so
the CDP client, action core, perceive layer, and verb layer are write-once,
run-anywhere with no platform branches.

The OS leaks in at exactly **one** isolated seam — the launch/profile manager
(`launch/profiles.ts`) — in two spots:

| Concern | Mac | Linux | Windows |
|---|---|---|---|
| **Chrome executable** | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | `/usr/bin/google-chrome` (or `chromium`) | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| **Default profile dir** (the one to *avoid*, Chrome 136) | `~/Library/Application Support/Google/Chrome` | `~/.config/google-chrome` | `%LOCALAPPDATA%\Google\Chrome\User Data` |

Contained by: a `findChrome()` helper (per-platform candidate paths + PATH search
+ a `--chrome-path` override) and `os.homedir()` / `path.join()` for the dedicated
automation-profile location. Everything downstream of "here's the ws:// URL" is
OS-agnostic.

**Build/test posture:** Mac-first (the primary platform). Keep all OS-specific
logic behind the `findChrome()` / profile-path module so Linux/Windows are a
verification task, not a rewrite. "Portable in principle" ≠ "tested on Windows" —
don't claim the latter until someone runs it there.

### Perceive → act loop (the core contract)

1. `browser --mode live snapshot` → JSON: `[{ref:"e7", role:"button", name:"Publish"}, …]`
2. Claude reads it, decides.
3. `browser --mode live click e7` → action core re-resolves `e7`'s backendNodeId,
   waits-until-actionable, finds frame, dispatches real mouse event, returns
   `{ok:true}` or a structured error.

## Edge cases

- **SPA route changes fire no standard load event:** readiness rule = network
  quiet ~500ms OR an expected selector/AX node appeared, whichever first.
- **Stale node ("not found"):** re-resolve from `backendNodeId`; on miss, re-snapshot
  and surface a structured `stale_ref` error so Claude re-perceives rather than retrying blind.
- **Element covered by modal/spinner:** wait-until-actionable's hittable check
  fails closed; time out with a clear reason rather than clicking the overlay.
- **iframe (Confluence editor):** detect the right target/session; never assume top frame.
- **Chrome 136 default-profile block:** handled by design — Live always uses a
  dedicated `--user-data-dir`. If a user points it at the default dir, fail with
  a clear message explaining why.
- **Rich-text editors swallow synthetic input:** prefer real key events /
  `Input.insertText`; verify against Confluence specifically in `harden`.
- **WebSocket drop mid-session:** reconnect + re-attach targets; fail the in-flight
  command with a retryable error, don't hang.

## What we are NOT doing

- **No MCP** — decided; CLI + Skill instead.
- **No Playwright/Puppeteer dependency** — from scratch over CDP (the whole point).
- **No vision/screenshot-driven clicking** — DOM/AX refs only. (A `screenshot`
  verb for Claude to *look* is a possible later add, but not for targeting.)
- **No reuse of Claude Desktop's native host / bridge** — compliance: it rides
  Anthropic auth.
- **No autonomous loop / headless `claude -p`** — stays per-turn, human-in-the-loop,
  per CCVC guardrails.
- **Not chasing Playwright-grade universality** — two named jobs, opinionated
  single strategies, not a general-purpose library.
- **Not riding your everyday default Chrome profile** — Live uses a dedicated
  automation profile (required by Chrome 136, and safer anyway).

## Open questions

- **Project home:** sibling repo, or a subfolder shipped inside CCVC's VSIX?
  Affects build/packaging and the Skill's install path.
- ~~**Language/runtime**~~ **RESOLVED: TypeScript on Node.** Rationale: (1) cohesion
  with CCVC's existing TS/Node toolchain — shared types for the verb protocol,
  one build/`npm` story; (2) CDP is a JSON-over-WebSocket protocol, squarely
  Node's I/O-bound sweet spot (`ws` + async/await for request↔reply correlation);
  (3) all the CDP prior art (Playwright, Puppeteer, chrome-devtools-mcp) is
  Node/TS, so gotcha-resolution reads in our own language. Passed on Go/Rust
  (single-binary distribution is nice but costs translating all prior art out of
  TS and loses CCVC type-sharing — revisit only if standalone-binary distribution
  becomes a hard requirement) and Python (no CCVC cohesion, ships a runtime dep).
- **Does the "refusal follows the model" concern bite in practice?** Claude Code
  is still Claude; it may decline actions cowork also declined. Worth an early
  real-world probe (e.g. a benign Confluence edit) before investing in `harden`.
- **`eval <js>` escape hatch:** include from day one (pragmatic) or omit to keep
  the surface DOM/AX-pure? Lean include-but-document-as-last-resort.
- **Headed vs headless default for Sandboxed:** default headed so tests are
  watchable, with a `--headless` opt-in? (Resolves the earlier "Headless" naming
  worry — visibility is an orthogonal flag, not the mode.)

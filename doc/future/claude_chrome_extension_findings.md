# Claude Desktop ↔ Chrome Extension bridge — findings

**Date:** 2026-06-08
**Investigated version:** Claude Desktop `1.11187.4` (`/Applications/Claude.app`)
**Question:** Does Claude Desktop have the ability to talk to the Claude Chrome
extension (like a cowork tab does), and could this VS Code/Cursor extension
(CCVC) bridge Claude Code to that same browser channel?

> ⚠️ **Compliance note up front.** Most of what makes this bridge work lives
> *outside* CCVC's remit — it relies on Claude Desktop's own authenticated
> account session, a signed native-host binary Anthropic ships, and a remote
> "environment" that Anthropic's backend brokers. Reproducing the *transport*
> (native messaging ↔ unix socket) is mechanically simple; reproducing the
> *bridge* (binding a browser to a Claude session) is not something CCVC can or
> should do without a human decision. See "Compliance assessment" at the end.

---

## TL;DR

- **Yes, Claude Desktop has the capability, and it actively uses it.** Desktop
  installs a Chrome **Native Messaging host** and, when a browser tab is linked,
  spawns a helper process that bridges the Chrome extension to the Electron app
  over a local unix socket. On this machine the helper was **running live**
  during the investigation, connected to one of the whitelisted extension IDs.
- The capability is **not cowork-exclusive**. The native-messaging plumbing is a
  Desktop-app feature; cowork is one consumer of it. There is a separate
  "bridge" layer that binds a *browser session* to a *Claude session*
  (`bridge-state.json`), gated behind explicit user consent.
- **CCVC bridging Claude Code ↔ the Chrome extension is technically possible but
  practically and legally fraught.** The browser tool-calls ride inside an
  authenticated Claude session brokered by Anthropic's backend. CCVC has no such
  session and (per its own guardrails) must not create one. A *local-only*
  reuse — driving the browser from Claude Code's own MCP/tool layer without
  touching Anthropic auth — is the only direction worth considering, and it
  needs a human go/no-go first.

---

## Evidence

### 1. The native messaging host is installed and whitelisted

Manifest on disk:
`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json`

```json
{
  "name": "com.anthropic.claude_browser_extension",
  "description": "Claude Browser Extension Native Host",
  "path": "/Applications/Claude.app/Contents/Helpers/chrome-native-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://dihbgbndebgnbjfmelmegjepbnkhlgni/",
    "chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/",
    "chrome-extension://dngcpimnedloihjnnfngkgjoidhnaolf/"
  ]
}
```

- `type: stdio` ⇒ standard Chrome Native Messaging (Chrome launches the host and
  pipes JSON over stdin/stdout, 4-byte length-prefixed).
- Three whitelisted extension IDs — almost certainly stable / beta / dev
  channels of the Claude browser extension.
- Desktop *writes* this manifest itself: the bundled code (`index.js`, fn `Z8A`)
  enumerates `NativeMessagingHosts` dirs for **Chrome** and **Edge** on macOS
  (and `userData\ChromeNativeHost` on Windows) and installs the manifest there.
  So "is it available" isn't a static question — Desktop provisions it on launch.

### 2. The host helper is a Rust stdio↔socket relay, and it was running live

`/Applications/Claude.app/Contents/Helpers/chrome-native-host` — Mach-O
universal (x86_64 + arm64), Rust (tokio runtime; strings reference
`tokio`, `socket2`, `serde`).

Live process observed during investigation:

```
keldon  1845  /Applications/Claude.app/Contents/Helpers/chrome-native-host \
              chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/
```

Chrome launched the host with the calling extension's origin as argv[1] — the
textbook native-messaging handshake. **This is the definitive proof Desktop both
has and exercises the capability.**

Protocol strings pulled from the binary:

- `ToolRequest` struct `{ method, params }` — the unit of work.
- `tool_request`, `mcp_connected`, `status_response`, `native_host_version 0.1.0`,
  `Responding to ping`.
- Socket lifecycle: `Creating socket listener:`, `Socket server listening for
  connections`, `Socket location:`, `Removed empty socket directory`,
  `Migrating legacy socket file to directory layout:`, `Removing stale socket
  for dead PID`, `Socket directory has insecure permissions`.

So the helper: (a) speaks Chrome native messaging on stdio, (b) connects to a
unix-domain `.sock` that the Electron app listens on, and (c) shuttles
`ToolRequest{method, params}` between them. The `mcp_connected` string strongly
implies the Electron side exposes these as **MCP tools** internally.

> Note: the `rpc.sock` paths also found in `index.js` (`…/<runDir>/rpc.sock`)
> belong to a *different* channel — the cowork VM / `claude-ssh` agent
> transport — not the Chrome host. Don't conflate the two. The Chrome host's
> socket is created by the Rust binary under its own temp/socket dir.

### 3. The browser tool surface

Method names recovered from the bundled JS (`@ant/browser-tool-schemas` is
compiled into `.vite/build/index.js`):

- Navigation / page: `navigate`, `reload`, `read_page`, `get_page_text`,
  `page_text`, `page_metadata`, `page_size`
- Interaction: `click`, `type`, `fill`, `submit`, `hover`, `scroll`
  (`scroll_to`, `scroll_direction`, `scroll_amount`), `find`
- Capture: `screenshot` (with `capture_failed` error path)
- Batching: `browser_batch`, `browser_count`
- Related but distinct (the local "computer use" / teach-mode window, NOT the
  browser extension): `computer_use`, `computer_batch`, `computerUseTeach.js`.

This is a DOM-level automation surface delivered *through* the extension's
content scripts — not Chrome DevTools Protocol, not raw CDP.

### 4. The "bridge" binds a browser session to a Claude session (with consent)

`~/Library/Application Support/Claude/bridge-state.json`:

```json
{
  "<deviceId>:<accountId>": {
    "enabled": true,
    "userConsented": true,
    "environmentId": "env_016XUSjzSPdxfRbLXJxj8vN5",
    "localSessionId": "local_ditto_<deviceId>",
    "remoteSessionId": "cse_01Nrt1LA34Cffxvr4GVEEbBr",
    "processedMessageUuids": [],
    "pendingProcessedAcks": []
  }
}
```

Cross-referenced with `index.js`, there's a whole `BridgeState` manager:

- `updateBridgeState`, `ensureSession`, `forceNewLocalSession`,
  `setBridgeSession`, `pendingBridgePermissions`,
  `autoDenyPendingPermissionsForSession`.
- A poll loop (`kickPollLoop`, `_cap_redispatch`, `transportReconnectAttempts`,
  `reconnect_capped`) and a turn model (`pendingTurns`, `releaseTurnBlocks`,
  `stale_turn_reconnect`).
- Consent is first-class: `userConsented`, `_auto_denied … reason:"session_reset"`,
  `user_denied`, teach-mode activation on consent.

Reading the shape:

- `localSessionId` (`local_ditto_…`) = the on-device session.
- `remoteSessionId` (`cse_…`) = a **remote** session brokered by Anthropic's
  backend (`environmentId` `env_…`). "cse" ≈ Claude Session / Server-side
  Environment.
- The bridge marries a **consented browser** to a **Claude session** so that
  tool-calls produced server-side get dispatched to the local browser via the
  native host, and results/acks flow back (`processedMessageUuids`,
  `pendingProcessedAcks`).

`startCodeSession` also appears alongside the bridge code — i.e. the same
session machinery fronts Claude Code sessions inside Desktop. So Desktop already
unifies "run Claude Code" and "drive the browser" under one session manager —
which is exactly the union CCVC was imagining building.

---

## Answering the three sub-questions

1. **Does Desktop have the ability?** Yes — definitively. It installs the
   native-messaging manifest, ships the host binary, and runs it live when a
   browser is linked.

2. **Does it have it but not exercise it?** No — it *does* exercise it. The host
   process was actively connected to a whitelisted extension during the
   investigation, and `bridge-state.json` shows a consented, enabled session.
   What's gated is the *binding* (consent + a brokered remote environment), not
   the *capability*.

3. **Could CCVC run Claude Code AND drive the Chrome extension, bridging the
   two?** Partly, with heavy caveats — see next section.

---

## Could CCVC bridge Claude Code ↔ the browser? Options & trade-offs

### Option A — Piggyback on Desktop's existing native host (local IPC only)
Have CCVC connect to the *same* unix socket the `chrome-native-host` helper
uses, and inject/observe `ToolRequest{method, params}`.

- **Pro:** reuses the installed, signed host; no new browser surface.
- **Con:** the socket is owned by Desktop's Electron process and the session is
  bound by `bridge-state.json` to *Desktop's* account session. CCVC would be
  impersonating/riding Desktop's authenticated session — squarely against CCVC's
  compliance posture. **Rejected unless a human explicitly approves.**

### Option B — Stand up an independent native-messaging host
Ship our own host manifest (different name, our own binary) and our own
browser extension (or ask the user to point the existing one at us — not
possible without the extension cooperating, and its origins are whitelisted to
Anthropic's host name).

- **Pro:** clean separation; no Desktop session reuse.
- **Con:** requires shipping/publishing a browser extension and a signed native
  host — a large surface, and it re-implements what Anthropic already ships.
  Also can't reuse Anthropic's extension (origin whitelist is keyed to
  `com.anthropic.claude_browser_extension`).

### Option C — Drive the browser from Claude Code's own tool layer (CDP / MCP)
Skip the Anthropic extension entirely. Let Claude Code talk to a browser via an
MCP server (e.g. a Playwright/CDP-based MCP) that CCVC launches per-session.

- **Pro:** stays entirely within "the user's own local tools + per-turn user
  action." No Anthropic auth, no session impersonation, no extension publishing.
  Fits CCVC's interactive, human-in-the-loop model.
- **Con:** different mechanism than the Desktop extension (CDP, not content-script
  injection). Doesn't "bridge to *the Claude Chrome extension*" specifically —
  it gives Claude Code browser control by other means. If the goal is literally
  the *Anthropic extension*, this doesn't satisfy it; if the goal is *Claude
  Code can act in a browser*, this is the clean path.

### Recommendation
If the objective is **"Claude Code can drive a browser from inside CCVC,"**
Option C is the only one that respects CCVC's guardrails and doesn't require
publishing an extension. If the objective is specifically **"reuse Anthropic's
Chrome extension,"** that path runs through Desktop's authenticated session and
is a **human-decision / likely-not-permitted** item — flag, don't build.

---

## Compliance assessment (per CLAUDE.md guardrails)

- The Desktop bridge is inseparable from **Anthropic account auth** (the
  `cse_…` remote session under an `env_…` environment, brokered server-side).
  CCVC must not capture, reuse, or route requests through those credentials.
- Option A reuses Desktop's authenticated session → **violates** the "don't proxy
  Claude requests using the user's subscription creds" rule. Do not implement
  without explicit human sign-off.
- Option C uses the user's own local browser + an MCP tool invoked per turn →
  consistent with the guardrails (no auth surface, human-in-the-loop), **but** it
  is still a meaningful new capability and should get a human go-ahead before
  building.
- **Action:** this touches request routing and automation, so per CLAUDE.md the
  correct next step is a human go/no-go before any implementation.

---

## Open questions

- Exact socket path/dir the Rust host uses (the binary builds it at runtime under
  a temp/socket dir; not captured statically here). Would need to `lsof` the
  live `chrome-native-host` PID while a tab is linked to confirm.
- Whether the Electron side truly exposes the browser tools as a local MCP
  server (`mcp_connected` suggests yes) and whether that MCP endpoint is
  reachable independent of the bound remote session.
- Whether `cse_` stands for what's inferred ("Claude Session / Environment") —
  label is speculative.

## What this investigation did NOT do

- Did not modify, hook, or connect to Desktop's live socket.
- Did not touch, decode, or exfiltrate any auth material (the `oauth:tokenCache`
  / `dxt:allowlistCache` blobs in `config.json` were left alone).
- Did not implement any bridge — findings only, per plan mode.

## Reproduction pointers (read-only)

- Manifest: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json`
- Host binary: `/Applications/Claude.app/Contents/Helpers/chrome-native-host`
- Bridge state: `~/Library/Application Support/Claude/bridge-state.json`
- Bundled logic: extract `app.asar` (`npx @electron/asar extract …`), grep
  `.vite/build/index.js` for `bridge`, `localSessionId`, `browser_`, `ToolRequest`.

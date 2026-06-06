# Claude Code control-protocol surface

**Status: authoritative reference.** This maps the full bidirectional control
protocol that the `claude` CLI speaks over `stream-json` stdio — the same
channel this extension already uses for `initialize` / `set_model` /
`interrupt` / `can_use_tool`. Keep it current; future sessions should read this
instead of re-deriving the surface from scratch.

## Provenance — how this was learned

- **Inspected:** 2026-06-05.
- **Packages:** `@anthropic-ai/claude-agent-sdk@0.3.165` and
  `@anthropic-ai/claude-code@2.1.165`, installed **fresh from the public npm
  registry into an ephemeral Linux sandbox.** This is **not** the user's
  installed binary and **not** a copy bundled with the assistant — it was pulled
  from npm specifically to read the types.
- **Source of truth within the package:** the TypeScript declaration file
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`. The
  `@anthropic-ai/claude-code` npm package ships only a compiled native binary
  (`bin/claude.exe`, ~244 MB, no readable JS), so the protocol shapes come from
  the companion Agent SDK package, which is the SDK's own typed view of the
  control channel the CLI implements.
- **Version coupling:** the two packages released in lockstep at the same patch
  number — CLI `2.1.165` ↔ SDK `0.3.165`. Treat the SDK minor/patch as tracking
  the CLI patch. The subtype union grows most releases, so this list is a
  floor, not a ceiling.
- **Verify the locally installed CLI** before relying on any single subtype:
  `claude --version`. If it differs from 2.1.165, re-run the inspection (see
  "Re-deriving" at the bottom) — newer builds add subtypes, rarely remove them.

## Verified live (2.1.165, unauthenticated linux-arm64 sandbox, 2026-06-05)

Driven by spawning the real native binary in `stream-json` mode and sending raw
control requests. The control channel responds **without authentication** for
state-setting subtypes (no model turn needed), so these were confirmed end to end:

- **`initialize`** → `success`, response keys: `commands, agents, output_style,
  available_output_styles, models, account, pid`. (`account` keys: `tokenSource,
  apiProvider`.) Models list is account-dependent — the unauthenticated default
  returned `default | sonnet | sonnet[1m] | haiku`.
- **`set_max_thinking_tokens`** → `success` with empty body for `31999`,
  `999999999`, `0`, `-5`, and `null`. **No protocol-level validation/clamping** —
  any integer is accepted; real clamping happens at model-turn time.
- **`set_permission_mode`** → `success`, echoes `{ mode }`, and emits a one-way
  `system/status` event. Confirms **plan mode flips in-band** (no respawn).
  Validation is loose: `mode:"bogus_mode"` was also accepted — send only valid
  `PermissionMode` values.
- **`get_settings`** → `{ effective, sources, applied }`. `applied` is the
  resolved live config, e.g. `{ model: "claude-opus-4-8[1m]", effort: "high",
  ultracode: false }`. **`effort` is the modern thinking dial.** Effort levels are
  **per-model**, advertised in the `initialize` models list as
  `supportedEffortLevels` (verified: Opus 4.8 = `low|medium|high|xhigh|max`;
  Sonnet 4.6 = `low|medium|high|max` — note Sonnet has **no** `xhigh`). Default
  applied `high`. (Correction to an earlier note in this doc's history: `max` IS a
  valid effort level on Opus 4.8 — do not assume a fixed `low|medium|high|xhigh`
  set; read `supportedEffortLevels` per model.) Each model also advertises
  `supportsEffort`, `supportsAdaptiveThinking`, `supportsFastMode`,
  `supportsAutoMode` — gate UI on these rather than hard-coding.
- **`apply_flag_settings { settings: { effort: "xhigh" } }`** → `success`, and
  the value lands in `effective.effort`. **BUT no validation** (`"banana"` and
  `"ULTRATHINK"` were accepted into `effective`), and the **resolved
  `applied.effort` stayed `"high"`** regardless — i.e. `effective` is a raw
  passthrough while `applied` is gated by account/model capability. Whether
  effort actually changes behavior must be confirmed against an **authenticated**
  binary with an xhigh-capable model. (Per the SDK types, `xhigh`/`ultracode`
  require a capable model and workflows enabled.)

### Thinking *display* is a third lever (the dark-pane bug) — verified

Separate from `effort` (how much) and `max_thinking_tokens` (legacy budget) is
**thinking display** (whether summarized reasoning text is streamed at all).
The native binary embeds its own Opus 4.8 migration guide; verbatim strings:

> "Thinking content omitted by default." · "`thinking.display` defaults to
> `"omitted"`; set `"summarized"` if you surface reasoning to users." · "silent
> change from Claude Opus 4.6, where the default [was summarized]." ·
> "`thinking: {type:'enabled', budget_tokens:N}` is no longer supported on
> Opus 4.7+ and returns a 400."

SDK type (`sdk.d.ts`): `ThinkingAdaptive = { type:'adaptive'; display?: 'summarized'|'omitted' }`.
The CLI-side levers are **settings keys**, not an `initialize` field (initialize
carries no thinking field): `thinkingDisplay` (`'summarized'|'omitted'`),
`showThinkingSummaries` (bool), `alwaysThinkingEnabled` (bool). Live-verified:
`apply_flag_settings { settings: { thinkingDisplay:'summarized',
showThinkingSummaries:true, alwaysThinkingEnabled:true } }` is accepted into
`effective` settings. Whether the live apply flips display mid-session (vs.
needing the key in settings.json at spawn) and which key the CLI actually reads
needs an **authenticated** turn against Opus 4.8 to confirm (watch for
`thinking_delta` text returning). For a session pinned to `opus-4-8[1m]`, the
durable fix is almost certainly `thinkingDisplay: "summarized"` (or
`showThinkingSummaries: true`) in the same `.claude/settings.local.json` the
extension already writes the model into — settings are re-read each spawn, so it
survives in-band `set_model`.

**Implication for the Ultrathink/thinking redesign:** two real, in-band levers
exist — `set_max_thinking_tokens` (precise numeric budget, model-agnostic,
predictable) and `effort` via `apply_flag_settings` (the native dial the
`ultrathink` keyword maps into, but account/model-gated). Either replaces the
prompt-prefix hack in `runTurn`; send the control request at the idle boundary
(same deferral pattern as `set_model`) instead of mutating the user's message
text. Confirm effort's real effect on an authenticated binary first
(see `probe_thinking.mjs`).

## Wire mechanics

Three envelope types travel over the same stdio JSON stream, newline-delimited:

```jsonc
// request (either direction)
{ "type": "control_request", "request_id": "<id>", "request": { "subtype": "...", ... } }
// response to a request
{ "type": "control_response", "response": { "subtype": "success", "request_id": "<id>", "response": { ... } } }
{ "type": "control_response", "response": { "subtype": "error",   "request_id": "<id>", "error": "..." } }
// cancel an in-flight request
{ "type": "control_cancel_request", "request_id": "<id>" }
```

- **Correlation** is by `request_id` (the extension already does this in
  `subprocess.ts` `sendControlRequest()` / `handleControlResponse()`).
- **Direction matters.** Some subtypes are sent by *us* (extension → CLI) and we
  await the response. Others are sent by the *CLI* to us (CLI → extension) and we
  must answer them (`can_use_tool`, `elicitation`, `request_user_dialog`,
  `hook_callback`). Plain stream events (`stream_event`, `system`, `assistant`,
  `user`, `result`) are one-way notifications, not control requests.
- `--permission-prompt-tool stdio` is what routes `can_use_tool` over this
  channel. `--dangerously-skip-permissions` suppresses it (and therefore also
  suppresses `AskUserQuestion`), which is why the extension never uses that flag.

## Full subtype inventory (CLI 2.1.165)

Legend — **USED**: wired in this extension today. **WIRE**: available, high
value, not yet used. **INBOUND**: CLI → extension, we must answer. **EVENT**:
one-way stream notification. **ADV**: advanced/niche.

### Outbound control requests (extension → CLI)

| subtype | status | one-liner |
|---|---|---|
| `initialize` | USED | Handshake. Returns models, commands, agents, output styles, account. Accepts hooks/systemPrompt/agents/skills/title/toolAliases. |
| `set_model` | USED | Switch model for subsequent turns. `{ model? }` |
| `interrupt` | USED | Stop the running turn. (no payload) |
| `set_permission_mode` | WIRE | `{ mode }` — `default \| acceptEdits \| bypassPermissions \| plan \| dontAsk \| auto`. **Flips plan mode in-band — replaces respawn-on-plan-toggle.** |
| `apply_flag_settings` | WIRE | `{ settings }` — inject settings.json-shaped config into the live session. Direct in-band answer to "flags need a restart." |
| `set_max_thinking_tokens` | WIRE | `{ max_thinking_tokens: number \| null }` — real thinking budget; replaces the THINK/ULTRATHINK prompt-prefix hack. |
| `get_context_usage` | WIRE | Full `/context` breakdown (tokens by category, memory files, MCP tools, agents, per-message split, auto-compact threshold). |
| `get_session_cost` | WIRE | The `/usage` cost summary text. |
| `get_settings` | WIRE | Effective merged settings + raw per-source. |
| `rename_session` | WIRE | `{ title }` — set session title directly. |
| `file_suggestions` | WIRE | `{ query }` — `@`-mention fuzzy file autocomplete the TUI uses. |
| `rewind_files` | WIRE | `{ user_message_id, dry_run? }` — `/rewind`: restore files to a prior message's state. |
| `mcp_status` | WIRE | Live connection state of all MCP servers. |
| `mcp_set_servers` | WIRE | `{ servers }` — replace the dynamically managed MCP server set live. |
| `mcp_toggle` | WIRE | `{ serverName, enabled }` — enable/disable an MCP server live. |
| `mcp_reconnect` | WIRE | `{ serverName }` — reconnect a failed/disconnected server. |
| `mcp_call` | WIRE | `{ tool, arguments? }` — invoke an MCP tool with **no model turn**. |
| `mcp_message` | ADV | `{ server_name, message }` — raw JSON-RPC to one MCP server. |
| `reload_plugins` | WIRE | Hot-reload plugins from disk; returns refreshed commands/agents/plugins/mcp. |
| `reload_skills` | WIRE | Hot-reload skills from disk; returns refreshed skill commands. |
| `set_color` | ADV | `{ color }` — session accent color (agent color name or `default`). |
| `get_binary_version` | ADV | Responder's CLI version (for `--remote` thin clients). |
| `background_tasks` | WIRE | `{ tool_use_id? }` — background in-flight bash/subagents (Ctrl+B). Omit id = background all. |
| `stop_task` | WIRE | `{ task_id }` — stop a running task. |
| `cancel_async_message` | ADV | `{ message_uuid }` — drop a queued async user message. |
| `read_file` | ADV | `{ path, max_bytes?, encoding? }` — read a file via the session (remote sidebar viewer). |
| `seed_read_state` | ADV | `{ path, mtime }` — seed the read-cache so an Edit validates after its Read left context. |

**Named in the request union but payloads not exported in the public types**
(treat as advanced/unverified — the subtype string is inferable from the type
name, but confirm against a live binary before use): `end_session`,
`channel_enable`, `generate_session_title`, `side_question`, `stage_file`,
`message_rated`, `submit_feedback`, `ultrareview_launch`, `remote_control`,
`oauth_token_refresh`, `host_auth_token_refresh`, and the MCP/Claude OAuth flow
requests (`mcp_authenticate`, `mcp_clear_auth`, `mcp_oauth_callback_url`,
`claude_authenticate`, `claude_oauth_callback`, `claude_oauth_wait_for_completion`).

### Inbound control requests (CLI → extension — we must answer)

| subtype | status | one-liner |
|---|---|---|
| `can_use_tool` | USED | Tool-permission prompt. Answer `{ behavior: 'allow'\|'deny', updatedInput?, ... }`. |
| `elicitation` | WIRE | MCP server requesting structured user input (`form` or `url` mode). Currently unhandled → may stall an MCP flow. |
| `request_user_dialog` | WIRE | Tool-driven blocking dialog (`{ dialog_kind, payload }`). Answer unrecognized kinds with `{ behavior: 'cancelled' }`. |
| `hook_callback` | ADV | Fires only if we register programmatic hooks in `initialize`. |

### One-way stream events (CLI → extension — notifications)

| subtype / type | status | one-liner |
|---|---|---|
| `system/init` | USED | session_id, tools, mcp_servers. |
| `system/status` | USED | e.g. `compacting`. |
| `system/compact_boundary` | USED | compaction trigger + pre-token count. |
| `stream_event` | USED | partial deltas (`content_block_start/delta`), thinking, text. |
| `assistant` / `user` / `result` | USED | message content, tool_result, turn end. |
| `commands_changed` | WIRE | Slash-command set changed — refresh the command list. |
| `session_state_changed` | WIRE | Session state mutated. |
| `permission_denied` | WIRE | A permission was denied (surface to UI). |
| `task_started` / `task_progress` / `task_notification` / `task_updated` | WIRE | Background-task lifecycle. |
| `hook_started` / `hook_progress` / `hook_response` | ADV | Hook lifecycle. |
| `notification` | WIRE | Generic notification. |
| `memory_recall` | ADV | Auto-memory recall event. |
| `local_command_output` | ADV | Output of a local command. |
| `files_persisted` | ADV | Files written/persisted. |
| `elicitation_complete` | ADV | URL-mode elicitation finished. |
| `plugin_install` | ADV | Plugin install event. |
| `api_retry` | WIRE | API call is being retried — useful "reconnecting…" signal. |
| `thinking_tokens` | USED* | Thinking token count (currently filtered as high-volume noise). |
| `mirror_error` | ADV | Mirror/remote error. |

## Key response & reference shapes

`initialize` response (`SDKControlInitializeResponse`):

```
commands: SlashCommand[]
agents: AgentInfo[]
output_style: string
available_output_styles: string[]
models: ModelInfo[]
account: AccountInfo
fast_mode_state?: FastModeState
```

`initialize` request accepts (beyond `hooks`/`sdkMcpServers`): `systemPrompt`,
`appendSystemPrompt`, `planModeInstructions`, `toolAliases`,
`excludeDynamicSections`, `agents`, `title`, `skills`, `promptSuggestions`,
`agentProgressSummaries`, `forwardSubagentText`, `jsonSchema`. Many of these are
"flags" you can set at handshake instead of as CLI args.

`PermissionMode` = `'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'`

`HookEvent` (for `initialize.hooks`) = `PreToolUse, PostToolUse,
PostToolUseFailure, PostToolBatch, Notification, UserPromptSubmit,
UserPromptExpansion, SessionStart, SessionEnd, Stop, StopFailure, SubagentStart,
SubagentStop, PreCompact, PostCompact, PermissionRequest, PermissionDenied,
Setup, TeammateIdle, TaskCreated, TaskCompleted, Elicitation, ElicitationResult,
ConfigChange, WorktreeCreate, WorktreeRemove, InstructionsLoaded, CwdChanged,
FileChanged, MessageDisplay`.

## What the extension uses today, and the respawn-trick implication

Used: `initialize`, `set_model`, `interrupt` (outbound); `can_use_tool` +
`AskUserQuestion` routing (inbound); the standard stream events.

Currently handled by killing the process and respawning with `--resume`
(`subprocess.ts`): **plan-mode toggle** and **settings/profile changes**. Most
of this has an in-band equivalent in the current binary:

- Plan toggle → `set_permission_mode { mode: 'plan' | 'default' }` (no respawn).
- Settings/flags → `apply_flag_settings { settings }` (no respawn).
- MCP config changes → `mcp_set_servers` / `mcp_toggle` / `mcp_reconnect`.
- Plugin/skill changes → `reload_plugins` / `reload_skills`.

The **genuinely launch-only residue** is real process-environment variables
(provider / account / region exported into the spawned env, read once at
startup). Those still want the `--resume` respawn. Everything that lives in
settings.json-shaped config is a candidate for `apply_flag_settings` — verify
with a live probe before refactoring the respawn paths away.

## Re-deriving (when the version moves)

```bash
cd /tmp && npm install @anthropic-ai/claude-agent-sdk@<version-matching-CLI>
cd node_modules/@anthropic-ai/claude-agent-sdk
grep -oE "subtype: '[a-z_]+'" sdk.d.ts | sort -u          # full subtype inventory
grep -n 'SDKControlRequestInner =' sdk.d.ts               # the outbound union
sed -n '/SDKControl.*Request = {/,/};/p' sdk.d.ts         # payload bodies
```

Match `<version>` to `claude --version` (CLI patch ↔ SDK patch).

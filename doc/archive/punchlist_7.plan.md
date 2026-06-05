---
name: Punchlist 7
overview: Two bugs. (1) AskUserQuestion renders as a generic auto-approved tool block (no interactive card / Submit button) whenever YOLO mode is on — confirmed by screenshot — because --dangerously-skip-permissions suppresses the can_use_tool control_request the interactive flow depends on. A possible secondary round-trip issue may exist in non-YOLO mode and is tracked too. (2) The "open in external terminal" breakout button builds a malformed osascript launch command for Terminal.app — confirmed cwd-quote dissolution and an empty trailing "" positional — and the session lands at ~ for a not-yet-confirmed reason.
todos:
  - id: auq-confirm-yolo-cause
    content: "Confirm via host log that NO can_use_tool control_request arrives for AskUserQuestion when yoloMode is on (--dangerously-skip-permissions)"
    status: pending
  - id: auq-surface-in-yolo
    content: "Move YOLO to extension layer: drop --dangerously-skip-permissions, always pass --permission-prompt-tool stdio, and add a yolo auto-approve short-circuit in handleControlRequest AFTER the AskUserQuestion early-return"
    status: pending
  - id: auq-roundtrip
    content: "Secondary (likely already correct): once the card renders in YOLO, confirm submit round-trips; handleAskUserQuestionResponse already writes a well-formed control_response, so only log/debug if resume fails"
    status: pending
  - id: auq-verify
    content: "Verify end-to-end with YOLO on: interactive card appears, submit, Claude resumes with the answer"
    status: pending
  - id: brk-add-log
    content: "Add diagnostic log of the exact launchCmd string in launchSlashCommand before cp.exec"
    status: pending
  - id: brk-fix-cwd-quoting
    content: "Escape single quotes in cwd (the '\\'' trick) in getTerminalLaunchCommand so the cd path survives osascript -e single-quoting"
    status: pending
  - id: brk-omit-empty-prompt
    content: "In launchSlashCommand external branch, only append the quoted prompt when fullCommand is non-empty"
    status: pending
  - id: brk-diagnose-tilde
    content: "Capture the host log during a real breakout to confirm why the session lands at ~ (cd not sticking)"
    status: pending
  - id: bump-version
    content: "Bump appcloud9.62 -> appcloud9.63 in package.json"
    status: pending
  - id: build-package-install
    content: "npm run compile, package VSIX, install with --force"
    status: pending
  - id: verify-all
    content: "Verify both: AskUserQuestion round-trips; breakout launches interactively in the project dir"
    status: pending
isProject: false
---

# Punchlist 7

Two bugs carried forward from punchlist_6 testing.

---

## 1. AskUserQuestion is non-interactive under YOLO mode

### Symptom (from screenshot)

When Claude calls `AskUserQuestion`, the webview shows a **generic tool block** — a
header "AskUserQuestion" and a "Result: Answer questions?" panel — instead of the
interactive `QuestionCard` (radio/checkbox options + free-text + Submit). There is no
Submit button at all, so the user cannot answer; the tool is auto-resolved with no UI.

This refines the earlier guess (which assumed the card rendered but the *answer* failed
to round-trip). The screenshot shows the card never renders in the first place.

### Root cause (confirmed by code; pending host-log confirmation)

The interactive flow is driven entirely by the permission-prompt channel:

1. `subprocess.ts:194-198` selects CLI flags by YOLO mode:
   ```ts
   if (yoloMode) {
       args.push('--dangerously-skip-permissions');
   } else {
       args.push('--permission-prompt-tool', 'stdio');
   }
   ```
2. The interactive question card is created **only** inside
   `permissions.handleControlRequest()` (`permissions.ts:41`), which runs **only** when
   the CLI emits a `can_use_tool` control_request. The AskUserQuestion branch
   (`permissions.ts:56-60`) calls `handleAskUserQuestion()` → posts
   `{ type: 'askUserQuestion', … status: 'pending' }`, which the webview turns into a
   `QuestionCard` (`AskUserQuestion.tsx:38-45`, `pendingQuestions` signal).

With `--dangerously-skip-permissions` (YOLO on — the user's default, set in
`.vscode/settings.json` as `claudeCodeChat.permissions.yoloMode: true`), the CLI does
**not** send `can_use_tool` requests. It just executes `AskUserQuestion` as an ordinary
auto-approved tool, so `handleControlRequest` never runs for it, `handleAskUserQuestion`
never posts the message, and the webview only sees a plain `tool_use`/`tool_result`
pair — the generic block in the screenshot.

This is why `punchlist_6.plan.md` called AskUserQuestion "fully working end-to-end" and
used it as the reference for the permission UI: it **is** fully working, but only in
**non-YOLO** mode. YOLO silently degrades it. (And note: the punchlist_6 permission-UI
work has the *same* dependency — it will also never appear under YOLO. See cross-cutting
note below.)

### Approach (finalize after the host log confirms what arrives in YOLO)

AskUserQuestion is not a "dangerous permission" — it is an interaction request that must
always be surfaced regardless of permission posture. Options:

- **A (preferred). Move YOLO from a CLI flag to an extension-layer auto-approve.** Always
  pass `--permission-prompt-tool stdio` (drop `--dangerously-skip-permissions` in
  `subprocess.ts:194-198`) so the `can_use_tool` channel stays open. Then add a YOLO
  short-circuit *inside* `handleControlRequest` (`permissions.ts:41`), placed **after** the
  AskUserQuestion early-return (`permissions.ts:56-60`) and **before** the
  `isToolPreApproved` check: when `yoloMode` is on, immediately
  `sendPermissionResponse(requestId, true, …)` to auto-allow. This preserves YOLO's
  frictionless feel while keeping AskUserQuestion (and any future real permission prompt) on
  the existing, working interactive path. Single code path, no new rendering logic.
  - Note: do **not** repurpose `isToolPreApproved` for this — that function reads a
    `permissions.json` allow-list file (`permissions.ts:279-323`) and is the wrong lever for
    a blanket YOLO allow. The short-circuit belongs in `handleControlRequest`.
  - `permissions.ts` needs the current `yoloMode` value: read
    `vscode.workspace.getConfiguration('claudeCodeChat').get('permissions.yoloMode')` at
    request time (cheapest), or thread it through `PermissionsDeps`.
- **B (fallback). Intercept AskUserQuestion from the normal assistant stream.** If the CLI
  cannot be coerced into emitting `can_use_tool` while honoring YOLO semantics, detect a
  `tool_use` with `name === 'AskUserQuestion'` in the stream (`subprocess.ts`
  `processJsonStreamData`) and inject the answer back as the tool_result. More invasive;
  only if A is blocked.

Pick A unless the host log shows the CLI behaves unexpectedly with `stdio` + auto-approve.

### Secondary: the answer round-trip appears already correct

On inspection, `handleAskUserQuestionResponse` (`permissions.ts:203-253`) already writes a
well-formed `control_response` — `behavior: 'allow'`, `updatedInput: { questions, answers }`,
`toolUseID` — then updates the saved conversation and posts `updateAskUserQuestionStatus`.
So the earlier "answer doesn't round-trip" suspicion is **probably a non-issue**; the failure
is upstream (the card never renders under YOLO). Still, once the card renders, confirm submit
resumes the subprocess. If it doesn't, log three points — webview `submitAnswers` before
`post` (`AskUserQuestion.tsx:66`), host `askUserQuestionResponse` case (`webview.ts:709`),
and inside `handleAskUserQuestionResponse` before the stdin write — checking
`getStdinAvailable()` and answer keying (`q.question` vs header/index).

### Files likely involved

- [src/subprocess.ts](src/subprocess.ts) — flag selection (`~194-198`); stream interception only if option B
- [src/permissions.ts](src/permissions.ts) — add YOLO short-circuit in `handleControlRequest` after the AskUserQuestion route; `handleAskUserQuestion` / `handleAskUserQuestionResponse` unchanged
- [src/webview/components/AskUserQuestion/AskUserQuestion.tsx](src/webview/components/AskUserQuestion/AskUserQuestion.tsx) — verified correct; no change expected
- Reference: `../claude-code-chat/src/permissions.ts` only if the round-trip turns out to need a different control_response shape

### Cross-cutting note for punchlist_6

The permission-request UI planned in punchlist_6 shares this exact dependency on
`can_use_tool` control_requests. Whichever fix is chosen here (A or B) must also make the
permission UI reachable under YOLO — or the two efforts should agree that YOLO means "no
permission prompts, but AskUserQuestion still interactive."

---

## 2. Breakout external-terminal launch (quoting + empty prompt)

> Carried over verbatim-in-substance from `fix_breakout_empty_command.plan.md`
> (that file is being deleted; this is the canonical copy).

### Background

The prompt pane's breakout button ("Open in external terminal", `PromptPane.tsx:435`)
posts `{ type: 'launchSlashCommand', command: '', forceExternal: true }`. The user's
settings route this through the external path (`terminal.useIntegrated: false`,
`terminal.externalApp: "Terminal.app"`, no `customTemplate`), so it goes through
`getTerminalLaunchCommand("Terminal.app", …)` which builds:

```
osascript -e 'tell app "Terminal" to do script "<escaped command>"'
```

Observed symptom: a Terminal window opens, but the session ends up at the home
directory (`~`) rather than the project dir, and no working Claude session results.

### What was verified (with reproductions)

1. **cwd quotes are stripped before reaching the terminal.** `getTerminalLaunchCommand`
   builds `posixWithCd = cd '<cwd>' && <claudeCmd>` (`webview.ts:1321`) with *raw* single
   quotes around the cwd, then embeds the whole thing inside `osascript -e '…'`
   (`webview.ts:1332`) — also single-quoted. The outer shell parse consumes the inner
   single quotes. Verified by having AppleScript echo back what it received:
   - Built string contains: `cd '/Users/keldon/…/claude-code-via-cursor'`
   - AppleScript actually receives: `cd /Users/keldon/…/claude-code-via-cursor` (quotes gone)

   For a space-free path this still `cd`s correctly, but any path with a space or shell
   metacharacter would break. The "protective" quoting is a no-op as written.

2. **A trailing empty `""` is always passed to claude.** `claudeCmd` (`webview.ts:1174-1176`)
   unconditionally interpolates `"${fullCommand}"`, so an empty breakout produces
   `claude … --resume <id> ""`. The integrated-terminal branch avoids this — it only
   pushes the command when truthy (`webview.ts:1157`).

### What is NOT yet confirmed

- **Why the session lands at `~`.** Reproductions from the agent's sandboxed shell were
  inconsistent (osascript automation-permission differences between the sandbox and the
  extension host). Quote-stripping alone does not explain a failed `cd` for a space-free
  path. The earlier theory that the empty `""` makes claude "one-shot and exit" is
  **unproven** and was set aside. Get a host log before claiming this is fixed.

### Approach

Diagnose, then fix.

1. Add a temporary `log.info` of the exact `launchCmd` right before `cp.exec`
   (`webview.ts:1196`). Rebuild, install, reproduce once.
2. Apply both confirmed fixes regardless of the log:
   - Escape single quotes in the cwd inside `getTerminalLaunchCommand`.
   - Omit the empty positional prompt in `launchSlashCommand`.

### Files to modify

- [src/webview.ts](src/webview.ts) — `launchSlashCommand` (~1174, empty prompt) and
  `getTerminalLaunchCommand` (~1321, cwd quoting); temporary diagnostic log (~1195)
- [package.json](package.json) — bump `appcloud9.X`

### Implementation details

**Empty prompt — `launchSlashCommand` ~1174.** Replace:

```ts
const yoloArg = yoloFlag ? ` ${yoloFlag}` : "";
const claudeCmd = sessionId
  ? `claude${yoloArg} --resume ${sessionId} "${fullCommand}"`
  : `claude${yoloArg} "${fullCommand}"`;
```

with:

```ts
const yoloArg = yoloFlag ? ` ${yoloFlag}` : "";
const resumeArg = sessionId ? ` --resume ${sessionId}` : "";
const promptArg = fullCommand ? ` "${fullCommand}"` : "";
const claudeCmd = `claude${yoloArg}${resumeArg}${promptArg}`;
```

**cwd quoting — `getTerminalLaunchCommand` ~1321.** Escape embedded single quotes with the
POSIX `'\''` idiom so they survive the outer `osascript -e '…'` parse:

```ts
const quotedCwd = cwd ? `'${cwd.replace(/'/g, `'\\''`)}'` : "";
const posixWithCd = cwd ? `cd ${quotedCwd} && ${command}` : command;
```

(Only the darwin/posix branches wrapping in `osascript -e '…'` / `bash -c "…"`. The Windows
branch uses different cd syntax — out of scope unless the log implicates it.)

**Diagnostic — temporary, ~1195:**

```ts
log.info("Webview", "external launchCmd", { launchCmd }, "🚀");
```

Remove or downgrade to debug once the `~` cause is understood.

### Edge cases

- **Path with spaces/apostrophes**: `'\''` escaping makes `cd` robust; today it only works
  for clean paths.
- **`customTemplate` path**: substitutes `{{command}}` with `claudeCmd`; the empty-prompt fix
  flows through. `getTerminalLaunchCommand` is NOT called in that branch, so cwd handling is
  the template author's responsibility (document, don't fix here).
- **No session + empty command**: yields `claude` (optionally `--dangerously-skip-permissions`) —
  a clean interactive launch.
- **Non-empty command**: quoting/escaping of real slash commands preserved.

### What we are NOT doing

- Not touching the integrated-terminal branch (already correct).
- Not changing the breakout button payload in `PromptPane.tsx` (empty command = intended
  "clean interactive launch") — pending user confirmation (see Open questions).
- Not reworking `--resume` vs `--continue` divergence between branches.
- Not claiming the `~` symptom is fixed until the host log confirms the mechanism.

---

## Open questions (both bugs)

- **Breakout-with-draft**: when the prompt box has unsent text, should the dedicated breakout
  button carry it into the external session (like `executeTerminalCommand`) or always do a
  clean interactive launch? This plan assumes clean launch.
- **Root cause of `~`**: unresolved until the diagnostic log is captured. Leading hypothesis:
  Terminal.app `do script` opens a *new login shell* whose profile (`setNodeVer`, the Kiro
  warning, the exit-code prompt) runs around the injected command; or `cp.exec`'s shell differs
  from the interactive shell. Revisit after the log.
- **AskUserQuestion control_response shape**: confirm against `../claude-code-chat` whether the
  AskUserQuestion tool result needs a different control_response payload than a plain permission
  approval.

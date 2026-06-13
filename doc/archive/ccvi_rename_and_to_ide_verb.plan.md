---
name: "CCVI rename + /plans toIDE verb (de-Cursor-ify)"
overview: "Rename the project Claude Code via Cursor → Claude Code via IDE (CCVC → CCVI), including extension/config/command ids, the working dir, git repo, and GitHub remote. Replace the Cursor-only `/plans toCursor` verb with an editor-agnostic `/plans toIDE <key>` driven by a settings-defined editor registry (command + destination dir per editor), launching via each editor's CLI binary and surfacing launch failures as a NoticeCard in the message history."
todos:
  - id: rename-repo-folder-git
    content: "Rename working dir + git repo + GitHub remote claude-code-via-cursor → claude-code-via-ide; update the git remote URL and the sibling-path refs that point back here"
    status: pending
    phase: "rename"
  - id: rename-package-identity
    content: "package.json: name → claude-code-via-ide, displayName → 'Claude Code via IDE', repository.url → new GitHub URL; bump appcloud9.X"
    status: pending
    phase: "rename"
  - id: rename-extension-command-view-ids
    content: "Rename extension id claude-code-via-cursor.* (command openChat, view ids, viewsContainers, registerCommand/registerWebviewViewProvider) → claude-code-via-ide.* across package.json + src/extension.ts + src/webview.ts"
    status: pending
    phase: "rename"
  - id: rename-config-namespace
    content: "Rename the ccvc.* config namespace → ccvi.* in package.json contributes.configuration AND all 25 getConfiguration('ccvc') call sites in src/"
    status: pending
    phase: "rename"
  - id: rename-ccvc-user-strings
    content: "Rename user-facing 'CCVC' literals → 'CCVI' in the webview (messages.ts attribution, MessagesList, PlanPhaseDialog header 'CCVC Q & A', ChatMessage); update README"
    status: pending
    phase: "rename"
  - id: settings-editor-registry
    content: "Add a ccvi.plans.editors registry setting (array of {key, command, directory}) seeded with cursor/code/idea; add it to FullSettings + the SettingsModal as an add-row ('+') table mirroring environment.variables"
    status: pending
    phase: "toIDE-skill"
  - id: skill-rename-verb-to-ide
    content: "In all three plans SKILL.md variants (chat, cowork, code), rename the toCursor verb → toIDE with a `<key>` param, generalize the prose off Cursor, and define the directory-resolution + launch-via-CLI + no-archive contract"
    status: pending
    phase: "toIDE-skill"
  - id: skill-decouple-archive
    content: "Remove archiving from toIDE entirely (it now never archives); leave the archive concept available as the separate future `/plans archive` verb (documented as out-of-scope here, not implemented)"
    status: pending
    phase: "toIDE-skill"
  - id: ui-rename-phase-to-ide
    content: "Rename the PlanPhase 'toCursor' → 'toIDE' in plan_phase.ts, PromptPane phase list, and PlanPhaseDialog (phaseTitle, commit switch, the dialog block)"
    status: pending
    phase: "toIDE-ui"
  - id: ui-editor-picker-dialog
    content: "Replace the toCursor archive-dir input with an editor-key picker (radios from the registry) in PlanPhaseDialog; commit() sends `/plans toIDE <plan> <key>`"
    status: pending
    phase: "toIDE-ui"
  - id: ui-handoff-record-cursor-only
    content: "Scope the recordPlanHandoff call to the cursor key only (the lone out-of-repo destination); other keys send no handoff row"
    status: pending
    phase: "toIDE-ui"
  - id: launch-failure-notice
    content: "When a picker-initiated toIDE launch command is not in PATH / exits nonzero, emit a {type:'notice', variant:'warning'} so it renders as a NoticeCard in the message history"
    status: pending
    phase: "toIDE-ui"
  - id: bbpi-verify
    content: "BBPI (bump already done in rename-package-identity — re-bump if needed), compile, package, install --force; verify toIDE works for cursor + code in both editors"
    status: pending
    phase: "verify"
isProject: false
---

# CCVI rename + `/plans toIDE` verb (de-Cursor-ify)

## Problem / Context

The project is named **Claude Code via Cursor** (CCVC) and its plan-handoff
verb is **`/plans toCursor`**, both of which assume Cursor specifically. But the
extension already runs in plain VS Code (this session is the first such run), the
host code is editor-generic (`plan_handoffs.ts` already has a generic `target`
field; an IntelliJ port plan exists), and the only genuinely Cursor-coupled piece
is the `~/.cursor/plans/` watched directory.

The user wants to **strip Cursor-specific language** — not Cursor support — so the
same build works cleanly in VS Code, Cursor, and (later) JetBrains IDEs. Two
threads, one motivation:

1. **Rename** the project to **Claude Code via IDE (CCVI)** — display name,
   extension id, config namespace, command/view ids, user-facing strings, **and**
   the working dir / git repo / GitHub remote.
2. **Replace `/plans toCursor`** with an editor-agnostic **`/plans toIDE <key>`**,
   driven by a **settings registry** of editors (each row = a launch `command` +
   a destination `directory`), launching via each editor's own CLI binary.

This is a **single-user rebuild** (the user is the only installer), so **no
migration shims** are needed — `ccvc.*` settings and old extension ids can be
renamed outright; orphaned old state is acceptable.

## Approach

### The editor registry (the core new concept)

A new setting **`ccvi.plans.editors`** holds an array of rows:

```jsonc
[
  { "key": "cursor", "command": "cursor", "directory": "~/.cursor/plans" },
  { "key": "code",   "command": "code",   "directory": "doc" },
  { "key": "idea",   "command": "idea",   "directory": "doc" }
]
```

`/plans toIDE <key>` looks up the row by `key`, then:

- **Resolve the destination directory** by this rule (confirmed with user):
  - leading `~` → expand to `$HOME` (absolute) — e.g. `~/.cursor/plans`
  - leading `/` → absolute, as-is
  - **anything else → relative to the project cwd** — e.g. `doc` → `{pwd}/doc`
- **Place the plan:** if the plan already lives in the resolved dir, **skip-copy**
  (just open). Otherwise **copy** it in. **Never archive** — archiving is gone from
  this verb (see *Out of scope* re: the future `/plans archive`).
- **Launch** via the row's `command` as a CLI passthrough: `<command> <path>`
  (replaces the hardcoded `open -a Cursor`). All commands are expected in `PATH`.
- **The param is open-ended:** any `key` present in the registry works; the three
  seeded rows are defaults and the Settings UI has a **"+"** to add more rows
  (each with its own command + dir).

### Launch failure → NoticeCard (no new UI needed)

The host **already** posts `{type:'notice', variant, title, ...}` messages that the
webview renders as a `NoticeCard` (see `src/webview.ts:190`, wired in
`src/webview/state/messages.ts:166`). A failed launch (command not in `PATH`, or
nonzero exit) reuses that exact path with `variant:'warning'` — **no new card
component, no new message type.**

### Cursor stays special in exactly one way

`~/.cursor/plans` is the only **out-of-repo** destination, so it's the only key
that produces a handoff "decoy" the picker must suppress. The
`recordPlanHandoff` message (and the `plan_handoffs.ts` table) therefore stays —
but **scoped to the `cursor` key only**. Other keys (`code`, `idea`, custom) copy
in-repo or open in place; CCVC's own picker (`sendPlanList`, `src/webview.ts:1654`)
already globs the workspace and sees them, so they need no handoff row.

## Conventions & assumptions

- **Casing:** `toIDE` is camelCase with the `IDE` initialism capitalized — matches
  the cross-skill rule (proper-noun/initialism targets are camelCase, like
  `toCursor` was). Plain verbs stay lowercase.
- **No migration shim** — single-user rebuild. Renaming `ccvc.*` → `ccvi.*` and the
  extension id will orphan the old install's settings/keybindings/state; that is
  **accepted**, not mitigated.
- **The skill lives outside this repo** at
  `/Users/keldon/Desktop/working/skills-anthropic/plans/{chat,cowork,code}/SKILL.md`
  — all three variants carry the verb (~43 Cursor mentions each) and must be edited.
  **Assumption:** directory-sourced skills go live on save (per memory
  `reference_directory_source_skills_live`), so editing them deploys globally
  immediately — coordinate the skill edit with the UI edit or the picker will send a
  verb the skill doesn't yet know (or vice-versa).
- **`/plans archive` is NOT implemented here** — it's named as the future home for
  the archiving behavior we're removing from `toIDE`, but building it is out of scope.
- **Repo rename is real** — folder, git repo, and GitHub remote all become
  `claude-code-via-ide`. The sibling-path reference `../claude-code-via-cursor` in
  `doc/future/intellij_idea_plugin_port.plan.md` (and any build scripts that assume
  it) must be updated to the new name. **Assumption:** `../claude-code-chat`
  (the reference predecessor repo) is NOT renamed — only this repo.

## The steps

### Phase: rename

**1. `rename-repo-folder-git`** — Rename the repo identity at the filesystem/VCS level.
- Rename the working directory `claude-code-via-cursor` → `claude-code-via-ide`.
- Rename the GitHub repo (`gh repo rename claude-code-via-ide` or via the web UI)
  and update the local remote: `git remote set-url origin <new-url>`.
- Update sibling-path refs that point back at this repo by old name — notably
  `doc/future/intellij_idea_plugin_port.plan.md` (`../claude-code-via-cursor`).
  Grep for `claude-code-via-cursor` and `via-cursor` across `doc/` and fix live
  (non-archive) references; **leave `doc/archive/*` untouched** (inert snapshots).
- WHY: the user chose full repo-identity rename, not just branding.
- DONE-WHEN: `git remote -v` shows the new URL; `git push` succeeds; cwd is the new
  folder; no live doc references the old repo name.
- ESCAPE HATCH: if the GitHub rename can't be done from here (auth/permissions),
  STOP and surface it — don't fake the remote update.

**2. `rename-package-identity`** — Edit `package.json`:
- `name`: `claude-code-via-cursor` → `claude-code-via-ide`
- `displayName`: `"Claude Code via Cursor"` → `"Claude Code via IDE"`
- `repository.url`: → the new GitHub URL
- Bump `appcloud9.X` to the **next** version (read current, increment).
- WHY: marketplace/extension identity.
- DONE-WHEN: `package.json` parses; version is incremented; no `via-cursor` literal
  remains in it.

**3. `rename-extension-command-view-ids`** — Rename the extension id and all
derived ids `claude-code-via-cursor.*` → `claude-code-via-ide.*`. Anchors:
- `package.json`: `contributes.commands[].command` (`...openChat`),
  `contributes.views` container key + view `id`s (`...chat`, the container
  `claude-code-via-cursor`), and every menu `command` ref.
- `src/extension.ts`: `vscode.commands.registerCommand('claude-code-via-cursor.openChat', …)`,
  `registerWebviewViewProvider('claude-code-via-cursor.chat', …)`,
  `statusBarItem.command`, `loadConversation` command id.
- `src/webview.ts`: any `executeCommand` / view-id literal.
- Also the bare `claude-code-via-cursor` string in `src/logger.ts` and
  `src/sessionImages.ts` (verify each is an id/log-scope, not a path).
- WHY: ids must be internally consistent or commands/views break.
- DONE-WHEN: `grep -rn claude-code-via-cursor src/ package.json` returns nothing;
  extension activates and the chat view opens after install.

**4. `rename-config-namespace`** — Rename config namespace `ccvc.*` → `ccvi.*`:
- `package.json` `contributes.configuration.properties` — all ~20 keys
  (`ccvc.wsl.*`, `ccvc.thinking.*`, `ccvc.permissions.*`, `ccvc.executable.*`,
  `ccvc.environment.*`, `ccvc.terminal.*`, `ccvc.modes.*`, `ccvc.firstRun.*`).
- All **25** `getConfiguration("ccvc")` call sites in `src/` → `getConfiguration("ccvi")`.
- WHY: the namespace must match the contributed keys or every setting reads
  undefined/default.
- DONE-WHEN: `grep -rn "ccvc" src/ package.json` returns nothing; settings read/write
  correctly after install (e.g. toggling yolo mode persists).
- NOTE: no migration shim — old `ccvc.*` user settings are abandoned by design.

**5. `rename-ccvc-user-strings`** — Rename user-facing **`CCVC`** → **`CCVI`**:
- `src/webview/state/messages.ts` (the `'ccvc'` role attribution string — rename the
  display label, NOT necessarily the role-key union value unless trivially safe),
  `src/webview/components/MessagesList/MessagesList.tsx`,
  `src/webview/components/PlanPhaseDialog/PlanPhaseDialog.tsx` (the `"CCVC Q & A"`
  header and `ccvc-qa` class — class renames optional, label required),
  `ChatMessage.less` / `PlanPhaseDialog.less` (cosmetic class names — optional),
  and `README.md`.
- WHY: branding consistency.
- DONE-WHEN: no user-visible "CCVC" text remains (the `ccvc-` CSS class prefix may
  stay if renaming it is risky — it's invisible to users; note any left behind).

### Phase: toIDE-skill

**6. `settings-editor-registry`** — Add the editor registry setting.
- `package.json`: add `ccvi.plans.editors` (array; default = the three seeded rows
  above) to `contributes.configuration`.
- `src/webview/state/settings.ts`: add `"plans.editors": Array<{key:string; command:string; directory:string}>` to `FullSettings`.
- `src/webview/components/SettingsModal/SettingsModal.tsx`: add an editor-registry
  section as an **add-row table mirroring the `environment.variables` pattern**
  (anchors: `envVars`/`entries`/`updateSetting("environment.variables", …)` around
  L275–338, and the `"+ Add Variable"` button at L338). Each row edits `key`,
  `command`, `directory`; a "+" adds a row.
- WHY: the verb's behavior is data-driven from this table.
- DONE-WHEN: the table renders in Settings with the 3 seeded rows; adding/editing a
  row persists to `ccvi.plans.editors` and survives reload.

**7. `skill-rename-verb-to-ide`** — In **all three** SKILL.md variants
(`chat/`, `cowork/`, `code/skills/plans/`), rename `toCursor` → `toIDE`:
- Change the verb name, its invocation-table row, the help cheat-sheet line, and the
  `PlanPhase`/description mentions in frontmatter `description:`.
- Rewrite the verb section to the new contract: param is an editor **`<key>`**;
  resolve its destination dir by the `~`/`/`/relative rule above; **skip-copy if
  already there, else copy; never archive**; **launch via the row's CLI command**
  (`<command> <path>`) instead of `open -a Cursor`; on launch failure, surface it.
- Generalize the surrounding prose off "Cursor" (the "lone vendor-coupled verb"
  framing becomes "the editor-launch verb"; `~/.cursor/plans` becomes "the cursor
  row's directory, one example among the registry rows").
- WHY: the skill is the actual executor; the UI just sends `/plans toIDE …`.
- DONE-WHEN: all three variants say `toIDE`, zero stray `toCursor`; the cheat-sheet
  and invocation table match; `grep -rn toCursor` in the skill dir is empty.

**8. `skill-decouple-archive`** — Remove archiving from `toIDE`.
- Delete the archive step + archiveDir param from the verb; delete the
  "Why archive is part of this verb" rationale.
- Add a one-line forward-pointer: archiving is now the (future, not-yet-built)
  `/plans archive` verb's job — document it as a known future verb, do NOT add it to
  the invocation table as if it exists.
- WHY: archiving was Cursor-decoy-specific; with open-ended dirs and skip-copy it's
  no longer part of handoff.
- DONE-WHEN: the `toIDE` section contains no archive step; the "no sixth verb"
  edge-case note is reconciled (archive is explicitly a *future* verb, still not
  auto-chained).

### Phase: toIDE-ui

**9. `ui-rename-phase-to-ide`** — Rename the `PlanPhase` member.
- `src/webview/state/plan_phase.ts`: `'toCursor'` → `'toIDE'` in the `PlanPhase`
  union and `DIALOGUE_PHASES`.
- `src/webview/components/PromptPane/PromptPane.tsx`: the phase list (~L761) and the
  `planPhase.value` display.
- `src/webview/components/PlanPhaseDialog/PlanPhaseDialog.tsx`: `phaseTitle`
  (`case "toCursor": return "send toCursor"` → `case "toIDE": return "send to IDE"`),
  the `commit()` switch case, and the dialog block guard (`phase === "toCursor"`).
- WHY: the UI phase key must match the new verb.
- DONE-WHEN: the phase picker shows "toIDE"; no `toCursor` literal remains in
  `src/webview/`.

**10. `ui-editor-picker-dialog`** — Replace the archive-dir input with an editor
picker.
- In `PlanPhaseDialog.tsx`, the `{phase === "toCursor" && (…archive dir input…)}`
  block (L324–336) becomes a **radio list of editor keys** read from
  `fullSettings.value?.["plans.editors"]` (label = `key`, description = its
  `directory`). Default-select `cursor`.
- `commit()`'s `toIDE` case sends `/plans toIDE ${p} ${selectedKey}` (no archive arg).
- Remove the `archiveDir` state + its seeding (L86, L100–106) — no longer used.
- WHY: the user picks which editor, the skill resolves dir+command from the registry.
- DONE-WHEN: opening the toIDE dialog lists the registry editors; committing sends
  `/plans toIDE <plan> <key>`.

**11. `ui-handoff-record-cursor-only`** — Scope the handoff row to `cursor`.
- The `recordPlanHandoff` post (L165–169) fires **only when `selectedKey === "cursor"`**
  (the lone out-of-repo dir). For other keys, send no handoff row.
- Keep computing `sourceOfTruthPlanFile` from the cursor row's resolved directory
  (`~/.cursor/plans/<base>`), not a hardcoded literal, so a customized cursor dir
  still aliases correctly.
- WHY: only out-of-repo destinations create a decoy the picker must suppress.
- DONE-WHEN: sending to `cursor` records a handoff row (picker shows the cursor copy,
  suppresses the original); sending to `code` records none and the in-repo file shows
  normally.

**12. `launch-failure-notice`** — Surface launch failures as a NoticeCard.
- Where the host runs the editor launch command (the `open -a Cursor` site being
  replaced — currently invoked via the skill's `Bash(open:*)`, but for
  picker-initiated launches that the host runs directly, OR via the skill's failure
  path), on command-not-found / nonzero exit, post
  `{type:'notice', variant:'warning', title:'Editor launch failed', data:{…}}`
  mirroring the existing notice senders (`src/webview.ts:190`, `:1268`, `:1414`).
- SPIKE (resolve at execution): determine whether the launch is run **host-side**
  (then the host owns the failure notice) or **inside the skill** via `Bash`
  (then the skill reports failure in its text reply and the host notice covers only
  host-run launches). Outcome A (host-run): add the try/catch + notice post in the
  host launch path. Outcome B (skill-run only): the skill's "When tools are denied /
  command fails" section reports it; the host notice is unused for toIDE — document
  that and drop the host-side post. Inspect the current `open -a Cursor` execution
  owner first; today the **skill** runs it (`Bash(open:*)`), so default to Outcome B
  unless the picker path is changed to host-run.
- WHY: a missing `code`/`idea`/`cursor` on PATH must fail visibly, not silently.
- DONE-WHEN: invoking toIDE with a bogus command surfaces a warning NoticeCard (or,
  under Outcome B, a clear failure line from the skill) — not a silent no-op.

### Phase: verify

**13. `bbpi-verify`** — Build, package, install, verify.
- BBPI: ensure `appcloud9.X` bumped (done in step 2; bump again only if another
  agent bumped since), `npm run compile`, `npx @vscode/vsce package --no-dependencies`,
  `code --install-extension <vsix> --force` (note: **`code`** in VS Code, `cursor`
  in Cursor — install into whichever you're verifying).
- Verify behaviorally: (a) chat view opens under the new id; (b) a setting persists
  (proves `ccvi.*` namespace works); (c) `/plans toIDE <plan> cursor` copies to
  `~/.cursor/plans` and opens Cursor; (d) `/plans toIDE <plan> code` opens the
  in-repo plan in VS Code with no archive/decoy; (e) a bogus editor key/command
  surfaces the failure notice.
- WHY: "compiles" ≠ "works" — confirm each renamed surface actually functions.
- DONE-WHEN: all five checks pass in at least one editor; cursor + code paths both
  exercised.

## Out of scope

- **`/plans archive` verb** — named as the future home for archiving, but NOT built
  here. Don't implement it; just leave the forward-pointer.
- **Migration shims** — deliberately none (single-user rebuild). Don't add
  read-old-write-new logic for `ccvc.*`→`ccvi.*` or old extension ids.
- **`../claude-code-chat`** — the reference predecessor is NOT renamed.
- **`doc/archive/*`** — inert snapshots; do not rewrite their `claude-code-via-cursor`
  references.
- **The `ccvc-` CSS class prefix** — cosmetic and invisible; rename only if trivially
  safe, otherwise leave and note it.
- **Auto-detecting the running editor** — rejected; the key is an explicit param.

## Verification

The whole change has landed when, after BBPI into a fresh install:
1. The extension shows as **Claude Code via IDE**, opens its chat view, and reads/writes
   `ccvi.*` settings (no `ccvc`/`via-cursor`/`CCVC` user-facing remnants:
   `grep -rn "ccvc\|claude-code-via-cursor\|CCVC" src/ package.json` is empty modulo
   any explicitly-noted cosmetic class prefix).
2. `git remote -v` points at `claude-code-via-ide` and `git push` works.
3. The plan-phase picker offers **toIDE**; choosing it lists the registry editors;
   committing sends `/plans toIDE <plan> <key>`.
4. `cursor` key → copies to `~/.cursor/plans`, opens Cursor, records a handoff row
   (picker suppresses the original, shows the cursor copy).
5. `code` key → opens the in-repo plan in VS Code, no archive, no handoff row.
6. A bogus key/command surfaces a warning notice (or a clear skill failure line per
   step 12's resolved outcome) — never a silent no-op.

**If reality doesn't match this plan at any step, STOP and surface it — don't
improvise.**

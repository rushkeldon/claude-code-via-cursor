---
name: Remove the shadow backup-repo feature (nuke to ground)
overview: "Fully remove CCVC's per-workspace shadow git 'backup repo' feature — the vestigial turn-by-turn workspace-snapshot machinery inherited from the claude-code-chat predecessor. Delete the module and all call sites (5 code edits across 3 files + delete src/backupRepo.ts), then delete the 5 on-disk backup repos in extension storage (~46MB). Rationale — it's off-ethos ('do what Claude does' — Claude Code keeps no shadow repo), per-WORKSPACE (not per-session, so it interleaves unrelated conversations into one linear timeline), redundant with normal git/branch workflow, and its restore UI was already dead in the Preact webview."
todos:
  - id: del-module
    content: "Delete src/backupRepo.ts entirely (184 lines)"
    status: pending
  - id: strip-extension
    content: "src/extension.ts — remove the backupRepo import (line 7) and the backupRepo.init({...}) block + initializeBackupRepo() call (lines 50–55)"
    status: pending
  - id: strip-subprocess
    content: "src/subprocess.ts — remove the backupRepo import (line 9) and the try/catch around createBackupCommit (lines 469–474), leaving surrounding setProcessing/postMessage logic intact"
    status: pending
  - id: strip-webview
    content: "src/webview.ts — remove the backupRepo import (line 11), the resetCommits() call (line 176), and the case \"restoreCommit\" handler (lines 437–439)"
    status: pending
  - id: verify-compile
    content: "npm run compile — confirm tsc + vite build pass with zero backupRepo references remaining (grep -r backupRepo src/ returns nothing)"
    status: pending
  - id: nuke-disk
    content: "rm -rf the 5 on-disk backup repos under ~/Library/.../Cursor/User/workspaceStorage/*/appcloud9.claude-code-via-cursor/backups (~46MB). Re-enumerate + confirm paths at execution time before deleting."
    status: pending
  - id: bbpi
    content: "Bump appcloud9.X, compile, package VSIX, install with --force (BBPI) so the running extension no longer creates backup commits"
    status: pending
isProject: false
---

# Remove the shadow backup-repo feature (nuke to ground)

## Background

CCVC carries a hidden feature inherited from its `claude-code-chat` predecessor: a
**second git repository** that shadows the workspace, committing a snapshot of the
working tree **before every prompt** (`Before: <first 50 chars of message>`). It
lives at `<workspace-storage>/appcloud9.claude-code-via-cursor/backups/.git`, with
its work-tree pointed at the real project but its git-dir off in extension storage —
invisible to the project's own `.git`. It surfaces (surfaced) restore points via
`showRestoreOption` messages and a `git checkout <sha> -- .` "restore" action.

The user did not know it existed. On review it should be removed, for four reasons:

1. **Off-ethos.** CCVC's posture is "do what Claude Code does." Claude Code keeps no
   shadow repo; this is a capability the underlying tool lacks, bolted on by the
   predecessor.
2. **Per-workspace, not per-session.** `backupRepoPath` derives from workspace
   storage with **zero** `sessionId` references. Verified: one workspace's repo held
   **1,280 commits across 16 different conversations** — all sessions interleaved
   into a single linear timeline, so "restore to before this turn" restores the whole
   workspace to a point that may sit between an *unrelated* session's turns.
3. **Redundant with normal git.** In a branch-first workflow the real repo already is
   the time machine (reflog/reset/diff), correctly scoped — the shadow repo is a
   worse, invisible, un-isolated copy.
4. **Already dead UI.** The Preact webview never re-implemented the restore UI from
   the old monolithic-HTML webview; the host kept committing while the UI silently
   dropped the `showRestoreOption` messages. Confirmed: zero restore rendering in
   `src/webview/`.

## Approach

Surgical removal. The feature is well-contained: one module
([src/backupRepo.ts](src/backupRepo.ts)) plus 5 call sites across 3 files. No
`package.json` commands or settings contribute to it. No webview code renders it.
The only persisted residue is `showRestoreOption` entries already sitting in old
conversation `*.json` files — harmless dead data the load path already ignores.

After the code is gone, delete the 5 on-disk backup repos to reclaim ~46MB and leave
nothing behind ("nuke to ground").

## Files to modify

- [src/backupRepo.ts](src/backupRepo.ts) — **delete the whole file** (184 lines).
- [src/extension.ts](src/extension.ts) — remove `import * as backupRepo from './backupRepo';`
  (line 7) and the `backupRepo.init({ … })` block + `backupRepo.initializeBackupRepo();`
  (lines 50–55).
- [src/subprocess.ts](src/subprocess.ts) — remove `import * as backupRepo from './backupRepo';`
  (line 9) and the `try { await backupRepo.createBackupCommit(message); } catch { … }`
  block (lines 469–474). Leave the surrounding `setProcessing` / `postMessage` logic
  intact.
- [src/webview.ts](src/webview.ts) — remove `import * as backupRepo from "./backupRepo";`
  (line 11), the `backupRepo.resetCommits();` call (line 176), and the
  `case "restoreCommit": await backupRepo.restoreToCommit(message.commitSha); return;`
  handler (lines 437–439).

## Implementation details

Call-site contexts (verified):

- **extension.ts:50–55** — a standalone `backupRepo.init({...})` object literal
  followed by `initializeBackupRepo()`. Delete both statements; nothing else depends
  on them.
- **subprocess.ts:469–474** — the only logic in the block is the backup commit; the
  `try/catch` exists solely to guard it. Remove the whole `try/catch`. The preceding
  `setProcessing` post and the following `deps.postMessage(...)` are unrelated and
  stay.
- **webview.ts:176** — `resetCommits()` sits between `setCurrentSessionId(undefined)`
  and `newSession()`; just delete that one line.
- **webview.ts:437–439** — delete the entire `case "restoreCommit":` arm from the
  message switch. (The webview no longer sends it; removing it is safe.)

Post-edit verification: `grep -r backupRepo src/` must return **nothing**, then
`npm run compile` must pass.

### On-disk deletion (nuke-disk)

5 targets enumerated at planning time (re-confirm at execution — paths/sizes drift):

```
~/Library/Application Support/Cursor/User/workspaceStorage/<hash>/appcloud9.claude-code-via-cursor/backups
```

planning-time inventory: `2354…` (80K/0 commits), `71c8…` (3.6M/4), `7f0d…`
(3.9M/44), `9fac…` (18M/92), `e91f…` (21M/1280). **~46MB total.**

Safety invariants (verified, re-verify before `rm`):
- Every target is under CCVC extension storage (`…/appcloud9.claude-code-via-cursor/backups`).
- The real project `.git` is separate and must NOT be touched; there is **no**
  `backups/` dir anywhere in the working tree.
- Re-enumerate with `find … -maxdepth 0 -type d` and print each path before deleting.

## Edge cases

- **Old `showRestoreOption` data in conversation `.json` files** — leave it. It's
  inert; the load/replay path has no handler and already skips it. Not worth a
  migration to scrub.
- **A backups repo recreated after code removal** — cannot happen once the code is
  gone; nothing calls `initializeBackupRepo`/`createBackupCommit`.
- **Running (old) extension still committing** — until the new VSIX is installed
  (BBPI), the live extension keeps making backup commits. Order: ship the code
  removal, then delete on-disk repos last (or accept they may regrow a commit or two
  until the new build is installed).

## What we are NOT doing

- **Not** rewriting any git history (no `filter-branch`); we delete repos wholesale.
- **Not** scrubbing `showRestoreOption` entries from existing conversation files.
- **Not** preserving or migrating any backup data — the user chose full removal.
- **Not** touching the real project repo or any non-CCVC storage.

## Open questions

- None blocking. (Product-identity string cleanup — the separate "Claude Code Chat"
  → CCVC edits in package.json / extension.ts — is tracked outside this plan and can
  ride in the same agent-mode pass.)

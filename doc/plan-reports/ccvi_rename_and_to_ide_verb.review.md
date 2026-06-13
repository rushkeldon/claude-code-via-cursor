# Review: CCVI rename + /plans toIDE verb (de-Cursor-ify)

**Overall: ready (with two small anchor gaps)** — A genuinely strong plan: explicit conventions, out-of-scope fence, escape hatches, behavioral done-whens, and stable symbol anchors with verified counts. Two user-facing-string sites the rename will miss as written, and one self-resolving SPIKE. None block execution; fix the two anchor gaps before/during build.

| Dimension | Grade | Notes |
|---|---|---|
| Execution-readiness | ✅ | No open questions. The one SPIKE (step 12) ships its own default resolution (Outcome B). |
| Stale assumptions | ✅ | Anchors verified live: 25 `getConfiguration("ccvc")` sites, 18 `ccvc.*` config keys (plan says "~20" — fine), all UI/skill symbols present, cited notice lines (190/1268/1414) all real. |
| Cross-surface risk | ✅ | Repo/git/remote rename fenced with an escape hatch; `doc/archive/*` and `../claude-code-chat` explicitly out of scope; no-migration-shim is a stated accepted loss. |
| Rails present | ✅ | Every todo has WHY + DONE-WHEN; global escape hatch repeated. Best-in-class. |
| TODO hygiene | ✅ | 13 todos, unique ids, ordered, phase-grouped, dependency-correct (rename → skill → ui → verify). |
| Mechanical lint | ✅ | Frontmatter parses (round-tripped); `isProject: false`; `overview` quoted; statuses valid; no hard-coded version (says "next"/"current+1"). |

## Findings

**rename-ccvc-user-strings** `[hygiene-issue]` — The todo's anchor list (messages.ts, MessagesList, PlanPhaseDialog, README) **misses a user-facing CCVC string**: `src/extension.ts:126` — `statusBarItem.tooltip = "Open CCVC (Ctrl+Shift+C)"`. That's a visible tooltip, squarely in this todo's "no user-visible CCVC text remains" done-when, but extension.ts isn't in the listed files. All other CCVC hits (subprocess.ts, webview.ts, .less files, message-routing comments) are code comments/class-prefixes the plan already scopes as optional. The done-when is correct; the anchor list is just incomplete.
Action: add `src/extension.ts:126` (statusBar tooltip) to this todo's anchor list.

**rename-extension-command-view-ids** `[hygiene-issue]` — The anchor list names webview.ts, extension.ts, logger.ts, sessionImages.ts, but **omits `src/webview/components/ToolMessage/ToolMessage.less:102`**, which contains `claude-code-via-cursor` (in a comment path example `…/claude-code-via-cursor/package.json`). The todo's own done-when grep — `grep -rn claude-code-via-cursor src/ package.json` returns nothing — *will* catch it, so the todo can't be falsely marked complete; but an implementer following only the anchor list would miss it and then be surprised by the grep. Minor: it's a comment, not an id.
Action: note ToolMessage.less:102 as an additional (comment-only) hit so the done-when grep doesn't surprise the implementer; decide keep-or-edit.

**launch-failure-notice** `[ready]` — Flagged only to confirm it's *intentionally* a SPIKE, not an unresolved decision. It ships a default (Outcome B: skill runs `Bash(open:*)` today, so the skill reports failure and the host post is dropped) and a concrete "inspect the execution owner first" instruction. That's the right pattern for a low-reasoning implementer — a decision with a stated default beats an open question. No action.

(All other todos — rename-repo-folder-git, rename-package-identity, rename-config-namespace, settings-editor-registry, skill-rename-verb-to-ide, skill-decouple-archive, ui-rename-phase-to-ide, ui-editor-picker-dialog, ui-handoff-record-cursor-only, bbpi-verify — verdict `ready`: anchors verified, done-whens behavioral, no drift.)

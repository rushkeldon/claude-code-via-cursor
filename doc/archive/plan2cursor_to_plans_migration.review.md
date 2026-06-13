---
report_type: review
plan: plan2cursor_to_plans_migration.plan.md
generated: "review run against live src/ tree and ~/.claude/plugins/installed_plugins.json on 2026-06-12"
findings:
  - id: install-cmd
    verdict: ready
    evidence: "Anchor verified exactly: src/webview.ts:1592 has [\"plugin\", \"install\", \"plan2cursor@skills-anthropic\", \"-s\", \"user\"] and src/webview.ts:1598 has the \"plan2cursor install failed\" log. WHY + DONE-WHEN ('only plugin install ids are modes@ and plans@') both present and checkable."
    action: "none — execution-ready"
  - id: firstrun-prompt-detect
    verdict: ready
    evidence: "Anchor verified: src/webview.ts:287 `let plan2cursorInstalled = false;`, :294 reads plugins[\"plan2cursor@skills-anthropic\"], :306 posts data: { modesInstalled, plan2cursorInstalled }. Line ~287 is exact. Stable string anchors back the line hint."
    action: "none — execution-ready"
  - id: check-skills-detect
    verdict: ready
    evidence: "Anchor verified: src/webview.ts:1624 `let plan2cursorInstalled = false;`, :1631 plugin-key read, :1638-1639 fs.existsSync(path.join(homedir, \".claude\", \"skills\", \"plan2cursor\", \"SKILL.md\")), :1645 posts the field. Line ~1620 hint is accurate (actual 1624)."
    action: "none — execution-ready"
  - id: firstrun-component
    verdict: ready
    evidence: "All four sub-anchors exist in FirstRun.tsx: type field :11, default literal :17, skill-row span :114 (<span class=\"first-run-skill-name\">plan2cursor</span>), badge :119, button gates :130 and :140. Sub-step (a) is precise about both the type field and the on(\"firstRunPrompt\") fallback literal."
    action: "none — execution-ready"
  - id: settings-component
    verdict: ready
    evidence: "Anchors verified in SettingsModal.tsx: type field :483 (matches ~483), skill-row span :548 (<span class=\"permission-tool\">plan2cursor</span>), description string :550 ('Send plans to Cursor's plans panel' — matches the quoted old copy), checkmark :552. The description-rewrite instruction quotes the exact existing text."
    action: "none — execution-ready"
  - id: compile-verify
    verdict: ready
    evidence: "Behavioral done-when ('clean build AND empty grep over src/') is correct and non-cosmetic. The WHY explicitly justifies grep-as-safety-net because the field is `as any` and tsc won't catch a half-renamed boundary — this matches the Conventions note and is the load-bearing check for the whole code phase."
    action: "none — execution-ready"
  - id: claudemd-docs
    verdict: ready
    evidence: "CLAUDE.md anchors confirmed: heading ### Plan workflow (`plan2cursor` + execution) at :80, the 'Archive the original' rule at :84, ### build2plan at :93, and the duplicate archive sub-step at :98. The plan correctly identifies that toCursor now owns archiving (verified against the installed plans SKILL.md toCursor verb) so the standalone archive rule is genuinely redundant. Preserves the skill-agnostic 'must not hard-code a version' and live-todo rules."
    action: "none — execution-ready"
  - id: vision-doc
    verdict: ready
    evidence: "Both mentions confirmed: doc/ref/vision.md:32 ('via the `modes` + `plan2cursor` skills') and :73 ('(`modes`, `plan2cursor`)'). Line hints (~32, ~73) exact. Pure string swap, low risk."
    action: "none — execution-ready"
  - id: bbpi
    verdict: ready
    evidence: "Follows the repo's BBPI convention and the 'next version' rule (no hard-coded number — current is 3.0.0-appcloud9.187, plan says bump to next). DONE-WHEN is behavioral (VSIX installs successfully + version incremented), not 'compiles'."
    action: "none — execution-ready"
overall: "ready — all 9 todos are execution-ready; every anchor verified against the live tree, the critical plugin-id assumption is confirmed published, frontmatter parses, and rails (why/done-when/fence/escape-hatch) are complete. A model plan; no corrections needed."
---

# Review: Migrate plan2cursor references to plans

**Verdict: READY.** This is a strong, low-reasoning-implementable plan. I verified every
anchor against the live `src/` tree and `~/.claude/plugins/installed_plugins.json`; all of
them match, the load-bearing assumption is confirmed, and the frontmatter parses cleanly.
No corrections are needed — there is nothing for `update` to apply.

## Rubric scorecard

| Dimension | Grade | Notes |
|---|---|---|
| Execution-readiness | ✅ | No unresolved decisions. Two product decisions explicitly *locked* (one-click install, no verb UI). No "Open questions" section. |
| Stale assumptions | ✅ | Every cited file/symbol/line still exists — see per-todo evidence. Line hints are paired with stable string anchors, so drift is self-correcting. |
| Cross-surface / regression risk | ✅ | The one real risk (host↔webview field rename across an `as any` boundary, tsc-blind) is explicitly called out in Conventions and fenced by the `compile-verify` grep. |
| Rails present | ✅ | Every code/doc todo carries a stable anchor, a WHY, and a behavioral DONE-WHEN. Out-of-scope fence is thorough (5 items). Escape hatch present (plugin-id confirmation). |
| TODO hygiene | ✅ | Atomic, ordered (code → verify → docs → release), unique ids, dependency-correct, grouped by `phase`. |
| Mechanical lint | ✅ | Frontmatter round-trips through YAML (9 todos, `isProject: false`). `overview` is quoted. No hard-coded version. Statuses all `pending` from the valid set. |

## What this plan does especially well

- **Stable anchors over line numbers.** Every line hint (`~287`, `~1620`, `~483`, `~32`,
  `~73`) is backed by a unique string anchor (the exact `cp.execFile` array, the
  `let plan2cursorInstalled = false;` declaration, the `<span class="...">plan2cursor</span>`
  markup). I confirmed the hints are accurate (e.g. `check-skills-detect`'s "~1620" is
  actually line 1624 — close, and the string anchor makes the drift irrelevant).
- **The `as any` trap is named, not discovered at runtime.** The Conventions section spells
  out that the compiler will *not* catch a missed rename, making `compile-verify`'s grep the
  real safety net rather than a formality. That's exactly the kind of why a lower-reasoning
  implementer needs.
- **The critical assumption is testable and was tested.** The plan hinges on the published
  id being `plans@skills-anthropic`. Confirmed: `installed_plugins.json` carries that exact
  key (alongside `modes@skills-anthropic`), and the plugin is cached at
  `~/.claude/plugins/cache/skills-anthropic/plans/1.0.0/`. The escape hatch (STOP if the id
  differs) is the right guard even though it's currently satisfied.
- **Doc rewrite is semantically correct, not just a string swap.** `claudemd-docs` correctly
  recognizes that `/plans toCursor` archives the original *itself*, making CLAUDE.md's
  standalone "Archive the original" rule redundant — this matches the installed `plans`
  SKILL.md's `toCursor` definition. It also correctly preserves the skill-agnostic rules
  (no-hard-coded-version, live-todo-status).

## Minor observations (not blockers, no action required)

- `firstrun-component` description copy ("Plan lifecycle: review, verify, send to Cursor,
  build, and update a .plan.md") and the `settings-component` copy are given as
  *suggestions* ("e.g. …"), which is appropriate — they're UI strings, not behavior. The
  implementer has latitude there without risk.
- The rubric source `doc/what_makes_a_good_plan.md` referenced by the skill does not exist in
  this repo; this review was graded against the rubric embedded in the `plans` skill itself.
  Not a defect in *this* plan — just noting the missing shared doc.

## Recommendation

Proceed directly to `toCursor` + `build` (or `build2plan` = the two composed). No `update`
pass is warranted — there are no findings to apply.

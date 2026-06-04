---
name: Status Bar Model Tooltip
overview: Collected punch-list of polish items for the session status bar. First item — show the full provider model string in a hover tooltip/overlay over the (truncated) model name, anchored above and right-aligned so it stays inside the extension panel.
todos:
  - id: model-name-hover-tooltip
    content: "Show full provider model string on hover over the status-bar model name, as a right-aligned overlay anchored above it"
    status: pending
isProject: false
---

# Status Bar Model Tooltip

## Background

The session status bar shows a short model label on the right (e.g. `Claude Opus 4.8` / `claude-opus-4-8`), truncated with an ellipsis at `max-width: 140px` so it doesn't blow out the layout when the panel is narrow ([SessionStatus.less:44](src/webview/components/SessionStatus/SessionStatus.less)). That short label is good for the always-visible case, but it hides the *full* provider string — region prefix, provider namespace, model ID, and context-window variant tag, e.g.:

```
us.anthropic.claude-opus-4-8[1m]
```

The user wants that full string available **on mouseover** without it ever being shown inline (too long for a narrow sidebar). The overlay must stay within the extension panel's bounds — since the model name sits flush against the right edge, the tooltip should anchor above the label and grow leftward (right-aligned) rather than center-overflowing off the right side.

## Approach

Two parts — a **data** part and a **UI** part. The UI part is the easy half; the data part is the gating question.

### Data: is the full string even available to the webview?

Today the webview's `resolvedModel` signal ([src/webview/state/session.ts:6](src/webview/state/session.ts)) is fed from two sources, and **neither is guaranteed to carry the full provider string**:

1. `getDisplayModel()` ([src/settings.ts:33](src/settings.ts)) maps the selected tier (`default`/`opus`/`sonnet`/`haiku`) to a short tier word via `MODEL_TIER_MAP`, or returns the raw custom-model env string. Sent at startup via the `model` field on the settings/init message ([src/webview.ts:326](src/webview.ts)).
2. The CLI's resolved model, captured from `jsonData.message.model` on the first `assistant` event and posted as `modelResolved` ([src/subprocess.ts:631-632](src/subprocess.ts)). This is the most authoritative value we get, but it likely contains only the bare model ID (e.g. `claude-opus-4-8`) — **not** the `us.anthropic.` region prefix nor the `[1m]` context-window tag, both of which live in the env/routing layer below what the CLI echoes back.

So before building the tooltip we must answer: **what is the longest/most-complete model string we can actually obtain?** Three candidate sources, in order of completeness:

- **(a) The env vars we set ourselves.** `setModelEnvVars()` ([src/settings.ts:131](src/settings.ts)) writes `ANTHROPIC_DEFAULT_OPUS_MODEL` etc. from the user's `settings.json` tier mapping. If the user configured `us.anthropic.claude-opus-4-8[1m]` there, *we already have the full string in the extension host* and just need to pass it through.
- **(b) The CLI's `message.model`.** Authoritative for what's actually serving the request, but probably the trimmed ID.
- **(c) Compose it.** Combine the configured env string (full, including `[1m]`) as the tooltip and keep the CLI's resolved ID as a cross-check.

**Recommended:** plumb the full configured env string from the host to the webview as a separate field (e.g. `resolvedModelFull`) alongside the existing short `resolvedModel`, so the inline label stays short and the tooltip shows the full string. If the full string equals the short one, suppress the tooltip (nothing extra to show).

### UI: the hover overlay

- Render the tooltip as a child of `.session-status-model` (which becomes `position: relative`).
- Absolutely position it: `bottom: 100%` (sits directly above the label), `right: 0` (anchors to the right edge so it extends leftward and never overflows the panel's right side), with a small `margin-bottom` gap.
- `white-space: nowrap` plus `max-width` capped to the panel width with its own ellipsis fallback — but the full string (~32 chars) should fit comfortably above when the label below is what's truncated.
- Show on `:hover` of `.session-status-model` via CSS (`opacity` + `visibility` transition) — no JS state needed for a pure hover overlay. If we later want it tappable/pinnable, promote to a signal.
- Theme it with `--vscode-*` variables only (per project styling convention): background `--vscode-editorHoverWidget-background`, border `--vscode-editorHoverWidget-border`, text `--vscode-editorHoverWidget-foreground`. These are the canonical hover-widget tokens and will match the user's theme.

## Files to modify

- [src/webview/components/SessionStatus/SessionStatus.tsx](src/webview/components/SessionStatus/SessionStatus.tsx) — wrap the model label so it can host an overlay child; bind the overlay text to the full-string signal; only render the overlay when full ≠ short.
- [src/webview/components/SessionStatus/SessionStatus.less](src/webview/components/SessionStatus/SessionStatus.less) — make `.session-status-model` `position: relative`; add `.session-status-model-tooltip` styles (absolute, `bottom: 100%; right: 0`, hover transition, hover-widget theme vars).
- [src/webview/state/session.ts](src/webview/state/session.ts) — add a `resolvedModelFull` signal fed by a new field on the model messages.
- [src/settings.ts](src/settings.ts) — expose the full configured model string (from the tier env mapping) so the host can send it.
- [src/webview.ts](src/webview.ts) — include the full string in the outgoing model/settings message.
- [src/webview/vscode.ts](src/webview/vscode.ts) — extend the relevant `MessageFromExtension` variant(s) with the new full-model field.

## Implementation details

```tsx
// SessionStatus.tsx — model label region
<div class="session-status-model">
  {resolvedModel.value}
  {resolvedModelFull.value && resolvedModelFull.value !== resolvedModel.value && (
    <div class="session-status-model-tooltip">{resolvedModelFull.value}</div>
  )}
</div>
```

```less
// SessionStatus.less
&-model {
  position: relative;           // anchor for the overlay
  // ...existing truncation styles unchanged...

  &-tooltip {
    position: absolute;
    bottom: 100%;               // directly above the label
    right: 0;                   // right-aligned → grows leftward, stays in panel
    margin-bottom: 6px;
    padding: 4px 8px;
    white-space: nowrap;
    font-size: 11px;
    border-radius: 4px;
    background: var(--vscode-editorHoverWidget-background);
    color: var(--vscode-editorHoverWidget-foreground);
    border: 1px solid var(--vscode-editorHoverWidget-border);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.12s ease, visibility 0.12s ease;
    z-index: 10;
    pointer-events: none;       // overlay shouldn't eat hover/clicks
  }

  &:hover &-tooltip {
    opacity: 1;
    visibility: visible;
  }
}
```

## Edge cases

- **Full string equals short label** (custom model configured as the bare ID, or no extra prefix/tag): suppress the tooltip — there's nothing more to reveal.
- **Very narrow panel:** with `right: 0` the overlay extends leftward; if the full string is wider than the panel, cap `max-width` to the panel and let the overlay itself ellipsize (rare — the full string is ~32 chars).
- **Model switches mid-session:** both `resolvedModel` and `resolvedModelFull` already update via the same message handlers — make sure the new full field is set on the same events (`modelResolved`, `modelSwitched`, etc.).
- **Touch / no-hover surfaces:** webview is desktop-only (VS Code/Cursor panel), so hover is fine; no tap fallback needed for now.

## What we are NOT doing

- Not changing the inline truncated label or its `max-width` — the short label stays exactly as-is.
- Not adding a click-to-copy or pin-tooltip interaction (could be a follow-up; pure hover for now).
- Not redesigning model selection or the `ModelSelector` dropdown.

## Open questions

- **What's the most complete model string we can actually source?** Confirm whether `jsonData.message.model` from the CLI ever includes the `us.anthropic.` prefix and `[1m]` tag, or whether the full string must come from our own configured env vars (`ANTHROPIC_DEFAULT_*_MODEL`). This decides whether the tooltip needs new host→webview plumbing or can reuse an existing field. **(This is the gating question — resolve before building.)**
- Should the tooltip prefer the *configured* string (what the user asked for) or the *CLI-resolved* string (what's actually serving)? If they ever differ, which wins — or do we show both?

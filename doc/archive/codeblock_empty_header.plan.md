---
name: Hide the empty CodeBlock header bar on language-less fences
overview: >
  A fenced code block with no language (```​ with nothing after the backticks)
  still renders the CodeBlock header strip — an empty bar holding only the copy
  button. It shows up most visibly when a slash-command / skill echo comes back
  wrapped in a bare ``` fence, producing a "card inside the Claude card" with a
  weird empty header. Drop the header bar when there's no language; keep the copy
  affordance via a hover button on the body instead.
todos:
  - id: float-copy-when-no-lang
    content: "CodeBlock.tsx: render the header bar only when lang is present; when absent, float the CopyButton over the body so copy still works without an empty strip"
    status: pending
  - id: style-floating-copy
    content: "CodeBlock.less: style the no-bar case (rounded top corners on the body, absolutely-positioned hover copy button top-right)"
    status: pending
  - id: verify-build
    content: "Build, bump version, package, install with --force; verify a bare ``` fence shows no empty header and copy still works, and a language fence is unchanged"
    status: pending
isProject: false
---

# Hide the empty CodeBlock header bar on language-less fences

## Background

When a Claude message contains a fenced code block,
[ClaudeMessage.tsx](../src/webview/components/ClaudeMessage/ClaudeMessage.tsx)
runs the content through `segmentMarkdown`
([markdown.ts](../src/webview/markdown.ts)) and renders each fenced segment as a
[CodeBlock](../src/webview/components/CodeBlock/CodeBlock.tsx) component. That
matches assistant-authored fences with a language (```ts, ```bash, …) and gives
them a header bar with the language label + a copy button.

The problem (see the user's screenshot): a slash-command / skill pass-through
echo — e.g. the `modes` skill's structured echo — comes back as assistant text
wrapped in a **bare** ``` fence (no language). `segmentMarkdown` still extracts
it as a `code` segment, so `CodeBlock` renders it — including the header bar. But
[CodeBlock.tsx](../src/webview/components/CodeBlock/CodeBlock.tsx) line 20 emits
`{lang || ''}`, so with no language the bar is an **empty strip** with just the
copy button floating in it. Visually that reads as a mysterious little header on
a "card inside the Claude card."

This is not unique to slash commands — **any** language-less ``` fence hits it —
but slash-command echoes are the common trigger because they're frequently
fenced and never carry a language.

## Approach

The header bar's whole job is to show the language label (the copy button is a
bonus). With no language there's nothing to label, so the bar should not render.
Keep the copy affordance by floating the `CopyButton` over the top-right of the
body on hover (the same pattern other copy hosts use), and round the body's top
corners since it's no longer capped by the bar.

When a language *is* present, render exactly as today — no visual change.

This is a presentation-only change in the
[CodeBlock](../src/webview/components/CodeBlock/CodeBlock.tsx) component; nothing
about segmentation, fence extraction, or the slash-command path changes. We do
NOT try to stop the echo from being fenced — faithfully rendering whatever the
CLI streams is correct; the bug is purely the empty header.

## Files to modify

- [src/webview/components/CodeBlock/CodeBlock.tsx](../src/webview/components/CodeBlock/CodeBlock.tsx)
  — conditionally render the header bar; float the copy button when there's no bar.
- [src/webview/components/CodeBlock/CodeBlock.less](../src/webview/components/CodeBlock/CodeBlock.less)
  — style the no-bar variant (rounded top, absolutely-positioned copy button).
- [package.json](../package.json) — bump `appcloud9.X` to the **next** version.

## Implementation details

`CodeBlock.tsx` — gate the bar on `lang`, add a modifier class when there's no
bar so CSS can float the copy button:

```tsx
export function CodeBlock({ code, lang }: CodeBlockProps) {
  const html = highlightCode(code, lang);
  const hasLang = !!(lang && lang.trim());
  return (
    <div class={`code-block-wrap${hasLang ? '' : ' code-block-wrap--nobar'}`}>
      {hasLang ? (
        <div class="code-block-bar">
          <span class="code-block-lang">{lang}</span>
          <CopyButton text={code} title="Copy code" class="code-block-copy-btn" />
        </div>
      ) : (
        // No language → no header strip. Keep copy as a hover button floated
        // over the body's top-right corner.
        <CopyButton text={code} title="Copy code" class="code-block-copy-btn code-block-copy-btn--float" />
      )}
      <pre class="code-block"><code class="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}
```

`CodeBlock.less` — the `--nobar` body keeps the rounded top (the bar used to cap
it), and the floating copy button sits top-right over the body:

```less
.code-block-wrap--nobar {
  position: relative;

  .code-block-copy-btn--float {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 1;
  }
  // body already rounds via the wrap's overflow:hidden; nothing else needed
}
```

Confirm the existing `.code-block-wrap { overflow: hidden; border-radius: 6px }`
already rounds the body's top in the no-bar case (it should, since the bar was
the only thing above it). If the `<pre>` paints square corners through the wrap,
add `border-top-left-radius`/`border-top-right-radius` to `pre.code-block` under
the `--nobar` variant.

## Edge cases

- **Fence WITH a language** — unchanged; the `hasLang` branch is the current
  markup verbatim.
- **`lang` is whitespace only** — `lang.trim()` treats it as no-language, which
  is the desired "bare fence" behavior.
- **Indented (4-space) code blocks** — `segmentMarkdown` routes these through the
  same `code` segment with no `lang`, so they also lose the empty bar. That's an
  improvement (they never had a meaningful language anyway).
- **Copy button discoverability** — the wrap already reveals `.copy-button` on
  hover (`.code-block-wrap:hover .copy-button { opacity: 0.7 }`); the floated
  button inherits that, so it stays discoverable without cluttering the resting
  state.

## What we are NOT doing

- Not changing how slash-command / skill output is captured or whether it's
  fenced — rendering the CLI's stream faithfully is correct.
- Not removing the copy affordance for bare fences — only the empty header strip.
- Not touching `segmentMarkdown` or `ClaudeMessage`.

## Open questions

- Should a bare fence keep the subtle body background + border so it still reads
  as "code," or render closer to inline/plain? Recommendation: keep the body
  styling (background + border) so code is still visually distinct; only the
  header bar is removed. (Assumed in the plan above.)

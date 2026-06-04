---
name: Drag and Drop Support
overview: >
  Enable drag and drop of images and code files into the extension panel. Uses the VS Code
  WebviewView drop provider API so drops are intercepted at the Electron level before VS Code
  opens the file. The entire panel is the drop target. Images attach visually; code files
  inject as a collapsed path + code block in the prompt.
todos:
  - id: package-json-drop-mime
    content: "Declare dropMimeTypes in package.json views contribution for the webview view"
    status: pending
  - id: extension-host-drop-provider
    content: "Implement a drop edit provider on the extension host that reads dropped files, determines type (image vs code vs PDF vs unsupported), and sends appropriate message to webview"
    status: pending
  - id: webview-drop-message
    content: "Add message handlers in the webview for 'fileDropped' (code/text) and reuse 'imageAttached' for images"
    status: pending
  - id: dropped-file-ui
    content: "Create a collapsible DroppedFile component showing file path + first 2 lines preview, expandable to full contents"
    status: pending
  - id: prompt-integration
    content: "Wire dropped files into the message send — include full file path + contents in the prompt text sent to Claude Code"
    status: pending
  - id: drop-overlay-ux
    content: "Show a visual drop zone overlay on the entire panel when dragging over (border highlight + label)"
    status: pending
  - id: verify-build
    content: "Build, install, test dropping images and code files from Finder and from VS Code explorer"
    status: pending
isProject: false
---

# Drag and Drop Support

## Background

Currently, dragging a file onto our extension panel causes Cursor/VS Code to open the file in an editor tab — the drop event never reaches our webview. The fix requires using VS Code's `WebviewView` drop provider API, which intercepts drops at the shell level and routes them to the extension host.

Claude Code can natively handle: text files, images, PDFs, and Jupyter notebooks. Office formats (.xlsx, .docx) are not supported.

## Approach

Register a `dropMimeTypes` declaration in `package.json` for our webview view, then implement the drop handling on the extension host side. The extension host reads the dropped file, determines its type, and posts a message to the webview. The webview renders the appropriate UI (image preview for images, collapsed code block for code files).

The entire panel is the drop target — dropping anywhere in the webview attaches to the current prompt.

## Files to modify

- [package.json](package.json) — add `dropMimeTypes` to the webview view contribution
- [src/extension.ts](src/extension.ts) — register the drop provider if needed
- [src/webview.ts](src/webview.ts) — implement drop handler, read files, post messages to webview
- [src/webview/components/PromptPane/PromptPane.tsx](src/webview/components/PromptPane/PromptPane.tsx) — handle `fileDropped` messages, manage dropped files state
- New: `src/webview/components/DroppedFile/DroppedFile.tsx` — collapsible file preview component
- New: `src/webview/components/DroppedFile/DroppedFile.less` — styles

## Implementation details

### package.json — dropMimeTypes

Add to the webview view definition:

```json
{
  "id": "claude-code-via-cursor.chat",
  "type": "webview",
  "name": "Claude Code via Cursor",
  "dropMimeTypes": ["text/uri-list", "image/png", "image/jpeg", "image/gif", "image/webp"]
}
```

`text/uri-list` is what Finder/Explorer sends when dragging files — it contains `file://` URIs.

### Extension host drop handler

The `WebviewViewProvider` gains an `onDrop` style handler. When VS Code routes a drop:

1. Extract file URIs from the `text/uri-list` data transfer item
2. For each file, determine type by extension:
   - Image extensions → read as base64 data URI, generate thumbnail, post `imageAttached`
   - Code/text extensions → read file contents as UTF-8, post `fileDropped` with `{ filePath, contents, language }`
   - PDF → post `fileDropped` with `{ filePath, contents: null, language: 'pdf' }` (pass path only; Claude Code reads it)
   - Unsupported → post `dropUnsupported` with `{ filePath, reason }` (show notice)

### Language mapping for code files

```ts
const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java', '.swift': 'swift',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
  '.css': 'css', '.less': 'less', '.scss': 'scss',
  '.html': 'html', '.xml': 'xml', '.svg': 'xml',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.sql': 'sql', '.md': 'markdown', '.txt': 'plaintext',
  '.rb': 'ruby', '.php': 'php', '.kt': 'kotlin',
  '.ipynb': 'json',
};
```

### DroppedFile component

A collapsible card in the prompt area (similar to image previews but for code):

- **Collapsed (default):** Shows file icon + relative path + first 2 lines of code as preview + "..." + remove button
- **Expanded:** Shows full file contents in a syntax-highlighted code block
- Click to toggle expand/collapse

### Prompt integration

When sending a message, dropped files are serialized into the prompt text:

```
File: src/components/Foo.tsx

\`\`\`tsx
<full contents>
\`\`\`
```

This goes into the `text` field of the `sendMessage` payload, prepended before the user's typed message. Claude gets the path and contents together.

### Drop overlay UX

When dragging over the panel, show a full-panel overlay:
- Semi-transparent background
- Dashed border
- "Drop files here" label centered
- Disappears on drag leave or drop

This requires the webview to detect dragenter/dragleave on the document. Even though the actual file reading happens on the extension host via the drop provider API, the webview still receives DOM drag events for visual feedback — it just can't access the file data from them.

## Edge cases

- **Multiple files dropped**: handle each independently — multiple images and/or code files in one drop
- **Large files**: always include full contents (user can expand to see); Claude Code has its own context limits
- **Binary files that aren't images/PDF**: show "unsupported" notice card
- **File from VS Code explorer vs Finder**: both produce `text/uri-list`, same handling
- **Workspace-relative paths**: show relative path when file is inside the workspace, absolute otherwise

## What we are NOT doing

- **Office files** (.xlsx, .docx, .pptx) — Claude Code can't read them natively
- **Live file watching** — we snapshot the file at drop time, don't track changes
- **Drag from webview back out** — one direction only (in)
- **Drag reordering** of dropped files — they appear in drop order

## Open questions

- None

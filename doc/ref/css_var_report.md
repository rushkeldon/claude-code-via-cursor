# VS Code CSS Theme Variables Reference

All `--vscode-*` CSS custom properties used in this extension's webview LESS files.

VS Code automatically injects these variables into webview stylesheets so extensions can match the user's active theme.

---

## Base / General

| Variable | Description | Fallback Used |
|----------|-------------|---------------|
| `--vscode-foreground` | Overall foreground color. Used as the default text color when not overridden by a component. | none |
| `--vscode-descriptionForeground` | Foreground color for secondary/description text providing additional information. | none |
| `--vscode-focusBorder` | Overall border color for focused elements. Applied on `:focus` states. | none |
| `--vscode-errorForeground` | Overall foreground color for error messages. | `#f48771` |

## Font

| Variable | Description | Fallback Used |
|----------|-------------|---------------|
| `--vscode-font-family` | The VS Code UI font family. | `-apple-system, BlinkMacSystemFont, sans-serif` |
| `--vscode-font-size` | The VS Code UI font size. | `13px` |
| `--vscode-editor-font-family` | The user's configured editor/monospace font family. | none |
| `--vscode-editor-font-size` | The user's configured editor font size. | none |

## Editor

| Variable | Description | Fallback Used |
|----------|-------------|---------------|
| `--vscode-editor-background` | Editor pane background color. Used as the main background of the webview. | none |
| `--vscode-editor-foreground` | Editor default foreground (text) color. | none |
| `--vscode-editorWidget-background` | Background color of editor widgets (e.g. Find/Replace dialog). Used for subtle surface backgrounds. | `rgba(127, 127, 127, 0.06)` or `rgba(127, 127, 127, 0.08)` |
| `--vscode-editorWarning-foreground` | Foreground color of warning indicators in the editor. | `#cca700` |

## Input Controls

| Variable | Description | Fallback Used |
|----------|-------------|---------------|
| `--vscode-input-background` | Input box background color. | none |
| `--vscode-input-border` | Input box border color. | none |
| `--vscode-input-foreground` | Input box text foreground color. | none |
| `--vscode-input-placeholderForeground` | Input box placeholder text color. | none |
| `--vscode-inputValidation-errorBackground` | Background color for input fields in an error validation state. | `rgba(198, 40, 40, 0.08)` |
| `--vscode-inputValidation-errorBorder` | Border color for input fields in an error validation state. | `#c62828` |

## Buttons

| Variable | Description | Fallback Used |
|----------|-------------|---------------|
| `--vscode-button-background` | Primary button background color. | none |
| `--vscode-button-foreground` | Primary button text color. | none |
| `--vscode-button-hoverBackground` | Primary button background color on hover. | none |
| `--vscode-button-secondaryBackground` | Secondary button background color. | `transparent` |
| `--vscode-button-secondaryForeground` | Secondary button text color. | `var(--vscode-foreground)` |

## Panel and Sidebar

| Variable | Description | Fallback Used |
|----------|-------------|---------------|
| `--vscode-panel-background` | Panel background color (the bottom panel area in VS Code). | none |
| `--vscode-panel-border` | Panel border color, used to separate panels from the editor. Heavily used for dividers. | none |
| `--vscode-sideBar-background` | Side Bar background color. | `var(--vscode-editor-background)` |

## List

| Variable | Description | Fallback Used |
|----------|-------------|---------------|
| `--vscode-list-hoverBackground` | Background color when hovering over list/tree items. Used for hover states on interactive elements. | none |

## Menu

| Variable | Description | Fallback Used |
|----------|-------------|---------------|
| `--vscode-menu-background` | Background color of menu/dropdown items. | none |
| `--vscode-menu-border` | Border color of menus/dropdowns. | none |

## Scrollbar

| Variable | Description | Fallback Used |
|----------|-------------|---------------|
| `--vscode-scrollbarSlider-background` | Scrollbar thumb background color in its default state. | none |
| `--vscode-scrollbarSlider-hoverBackground` | Scrollbar thumb background color when hovered. | none |
| `--vscode-scrollbarSlider-activeBackground` | Scrollbar thumb background color when actively dragged. | none |

## Text Blocks

| Variable | Description | Fallback Used |
|----------|-------------|---------------|
| `--vscode-textBlockQuote-background` | Background color for block quotes in rendered text. | `rgba(127, 127, 127, 0.05)` |
| `--vscode-textBlockQuote-border` | Border color for block quotes in rendered text. | `var(--vscode-panel-border)` |
| `--vscode-textCodeBlock-background` | Background color for inline/block code in rendered text. | `rgba(127, 127, 127, 0.12)`, `rgba(127, 127, 127, 0.08)`, or `rgba(0, 0, 0, 0.2)` (varies by context) |

## Charts

| Variable | Description | Fallback Used |
|----------|-------------|---------------|
| `--vscode-charts-orange` | Orange color from the VS Code charts palette. Used for accent highlights (e.g. thinking budget warnings). | `#ff9500` |
| `--vscode-charts-yellow` | Yellow color from the VS Code charts palette. Used for warning-level accents. | `#cca700` |

## Testing

| Variable | Description | Fallback Used |
|----------|-------------|---------------|
| `--vscode-testing-iconPassed` | Color for the "passed" icon in the test explorer. Used as a green/success accent. | `#4ec9b0` |

---

## Usage by Component

| Component | Primary Variables Used |
|-----------|----------------------|
| `globals.less` | `foreground`, `editor-background`, `font-family`, `font-size`, `scrollbarSlider-*` |
| `MessagesList` | `editor-font-family`, `editor-font-size` |
| `MessageInput` | `input-*`, `panel-*`, `button-*`, `focusBorder`, `menu-*`, `list-hoverBackground` |
| `ChatMessage` | `editor-foreground`, `editor-font-family`, `descriptionForeground`, `textCodeBlock-background`, `panel-border` |
| `ButtonBar` | `button-*`, `panel-border`, `focusBorder`, `list-hoverBackground` |
| `Header` | `panel-border`, `panel-background`, `foreground` |
| `ConversationHistory` | `sideBar-background`, `panel-border`, `list-hoverBackground`, `descriptionForeground`, `errorForeground` |
| `ThinkingPane` | `textBlockQuote-*`, `descriptionForeground`, `charts-orange` |
| `ThinkingPill` | `panel-border`, `editorWidget-background`, `textBlockQuote-*`, `descriptionForeground`, `focusBorder` |
| `StallHint` | `charts-yellow`, `editorWidget-background`, `textCodeBlock-background`, `descriptionForeground` |
| `ProfileChip` | `panel-border`, `editorWidget-background`, `focusBorder`, `testing-iconPassed`, `editorWarning-foreground`, `descriptionForeground` |
| `Modal` | `editor-background`, `panel-border`, `foreground` |
| `ModelSelector` | `panel-border`, `focusBorder`, `foreground`, `descriptionForeground` |
| `AuthErrorCard` | `inputValidation-error*`, `errorForeground`, `descriptionForeground`, `textCodeBlock-background`, `button-*`, `panel-border` |
| `TokenDisplay` | `panel-background`, `descriptionForeground` |
| `SessionStatus` | `panel-border`, `descriptionForeground` |
| `ToolMessage` | `editor-foreground` |

---

## Notes

- Variables without a fallback rely entirely on VS Code's theme injection. If the variable is missing (e.g. in a non-standard host), the property will be `unset`.
- Multiple fallback values for `--vscode-textCodeBlock-background` reflect different opacity needs: `0.12` for inline code, `0.08` for lighter blocks, `0.2` for dark-on-dark code blocks.
- `--vscode-sideBar-background` falls back to `--vscode-editor-background` to ensure consistency when the sidebar color is not explicitly set by a theme.
- The `--vscode-editor-font-family` variable is used anywhere monospace/code text is displayed (code blocks, the message input textarea, inline code).

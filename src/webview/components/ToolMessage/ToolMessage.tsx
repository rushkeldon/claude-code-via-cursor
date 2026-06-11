import "./ToolMessage.less";
import { ChatMessage } from "../ChatMessage/ChatMessage";
import { CopyButton } from "../CopyButton/CopyButton";
import { toolCategory } from "./tool_icons";
import { post } from "../../vscode";
import { useCollapsible } from "../Collapsible/useCollapsible";

interface ToolUseMessageProps {
  toolName: string;
  content: string;
  rawInput?: any;
}

function getCopyText(
  toolName: string,
  rawInput: any,
  content: string,
): string | null {
  if (toolName === "Bash" && rawInput?.command) return rawInput.command;
  if (rawInput?.file_path) return rawInput.file_path;
  if (content) return content;
  return null;
}

function isAbsolutePath(text: string): boolean {
  return /^\/[^\s]/.test(text);
}

// cursor:// is Cursor's deep-link scheme (fork of vscode://file/<abs-path>).
// encodeURI preserves the slashes while escaping spaces/unicode so the link
// doesn't truncate when pasted elsewhere.
function toCursorLink(absPath: string): string {
  return `cursor://file/${encodeURI(absPath)}`;
}

function openFile(filePath: string) {
  post({ type: "openFile", filePath } as any);
}

function openExternalUrl(url: string) {
  post({ type: "openExternalUrl", url } as any);
}

export function ToolUseMessage({
  toolName,
  content,
  rawInput,
}: ToolUseMessageProps) {
  const copyText = getCopyText(toolName, rawInput, content);
  const filePath = rawInput?.file_path;
  const hasClickablePath = filePath && isAbsolutePath(filePath);

  // The "Agent" tool spawns a subagent. Relabel it "Sub agent" (its real role)
  // and surface its `description` inline so the card isn't an empty "Agent" box.
  const isAgent = toolName === "Agent";
  const displayName = isAgent ? "Sub agent" : toolName;
  const agentDescription = isAgent
    ? (rawInput?.description as string | undefined)
    : undefined;

  // WebFetch carries the target URL in rawInput.url. Surface it inline (clickable,
  // right-aligned, start-truncated) exactly like a file-path tool's path, so the
  // card reads as a one-liner showing what's being fetched — and you can click to
  // open the same URL. (WebSearch isn't available to us, so we don't handle it.)
  const fetchUrl =
    toolName === "WebFetch" && typeof rawInput?.url === "string"
      ? (rawInput.url as string)
      : undefined;

  // For an absolute file path, put a clickable cursor:// link on the clipboard
  // instead of the bare path. Other copies (Bash command, content) stay plain.
  const clipboardValue = hasClickablePath ? toCursorLink(filePath) : copyText;

  // File-path tools (Read/Edit/Write) collapse to a single line: the path rides
  // inline in the header, right-aligned and start-truncated so the filename stays
  // visible. Other tools (Bash, etc.) keep their multi-line body below the header.
  const inlinePath = hasClickablePath;

  // Single-line header: file-path tools (inline path), the subagent card (name +
  // description), and WebFetch (name + url). The --inline class drops the body
  // divider/margin so the whole card is one line tall.
  const inlineHeader = inlinePath || isAgent || !!fetchUrl;

  // Category drives the shared --tool-accent CSS vars (set by cat-<category> on
  // the message root), which color BOTH the icon gradient and the accent border.
  const category = toolCategory(toolName);

  // A collapsible body only exists for non-inline tools that actually have
  // content (Bash output, etc.) — file-path tools already collapse to the inline
  // one-liner and have no body to fold. So we only show the chevron when there's
  // a body. Opt ChatMessage out of its own header-collapse (collapsible={false})
  // since the tool-header owns the toggle here.
  const hasBody = !!content && !inlineHeader;

  // A tool with no foldable body (e.g. WebFetch, or any tool whose input we don't
  // render) must still get the compact, divider-less header — otherwise the base
  // .tool-header shows a horizontal rule with empty space beneath it. Treat any
  // bodyless card as inline so it reads as a clean one-liner like Read/Edit.
  const inlineNoBody = !hasBody;
  const { displayed, toggle, chevron } = useCollapsible(true);

  return (
    <ChatMessage type="tool" showHeader={false} accent={category} collapsible={false}>
      <div
        class={`tool-header${inlineHeader || inlineNoBody ? " tool-header--inline" : ""}${hasBody ? " tool-header--toggle" : ""}${hasBody && !displayed ? " tool-header--collapsed" : ""}`}
        onClick={hasBody ? toggle : undefined}
        role={hasBody ? "button" : undefined}
        title={hasBody ? (displayed ? "Collapse" : "Expand") : undefined}
      >
        {hasBody && chevron}
        {/* Tool icon removed by request — the left-edge category color accent +
            the tool name are enough; the icon read as clutter. Kept (commented)
            for a one-line revert. */}
        {/* <div class="tool-icon" /> */}
        <div class="tool-info">{displayName}</div>
        {agentDescription && (
          <span class="tool-agent-desc" title={agentDescription}>
            {agentDescription}
          </span>
        )}
        {inlinePath && (
          // The rtl truncation in CSS clips the START of the path (ellipsis on the
          // left) so the filename stays visible; the path's LTR runs keep order.
          <span
            class="tool-file-link tool-file-link--inline"
            onClick={(e) => { e.stopPropagation(); openFile(filePath); }}
            title={filePath}
          >
            {/* `direction: rtl` (for left-side ellipsis) reorders the path's
                leading "/" — a bidi-neutral char — to the visual end, making it
                look like a trailing slash. Prefix a Left-to-Right Mark (U+200E)
                to anchor the slash inside the LTR run so it stays in front. */}
            {"‎" + filePath}
          </span>
        )}
        {fetchUrl && (
          // WebFetch target URL: right-aligned, clickable to open externally, and
          // end-truncated (ellipsis on the right) since the scheme+domain at the
          // start are the most identifying part of a URL.
          <span
            class="tool-file-link tool-url-link--inline"
            onClick={(e) => { e.stopPropagation(); openExternalUrl(fetchUrl); }}
            title={fetchUrl}
          >
            {fetchUrl}
          </span>
        )}
        {copyText && (
          <span onClick={(e) => e.stopPropagation()}>
            <CopyButton text={clipboardValue || ""} />
          </span>
        )}
      </div>
      {hasBody && displayed && <pre class="tool-body">{content}</pre>}
    </ChatMessage>
  );
}

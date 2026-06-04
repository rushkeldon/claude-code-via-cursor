import './ToolMessage.less';
import { useState } from 'preact/hooks';
import { ChatMessage } from '../ChatMessage/ChatMessage';
import { post } from '../../vscode';

interface ToolUseMessageProps {
  toolName: string;
  content: string;
  rawInput?: any;
}

function getCopyText(toolName: string, rawInput: any, content: string): string | null {
  if (toolName === 'Bash' && rawInput?.command) return rawInput.command;
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
  post({ type: 'openFile', filePath } as any);
}

export function ToolUseMessage({ toolName, content, rawInput }: ToolUseMessageProps) {
  const [copied, setCopied] = useState(false);
  const copyText = getCopyText(toolName, rawInput, content);
  const filePath = rawInput?.file_path;
  const hasClickablePath = filePath && isAbsolutePath(filePath);

  function handleCopy() {
    if (!copyText) return;
    // For an absolute file path, put a clickable cursor:// link on the clipboard
    // instead of the bare path. Other copies (Bash command, content) stay plain.
    const clipboardValue = hasClickablePath ? toCursorLink(filePath) : copyText;
    navigator.clipboard.writeText(clipboardValue).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      post({ type: 'copyToClipboard', text: clipboardValue } as any);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <ChatMessage type="tool" showHeader={false}>
      <div class="tool-header">
        <div class="tool-icon">T</div>
        <div class="tool-info">{toolName}</div>
        {copyText && (
          <button class="tool-copy-btn" type="button" title="Copy" onClick={handleCopy}>
            {copied
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
              : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>}
          </button>
        )}
      </div>
      {content && (
        <pre class="tool-body">
          {hasClickablePath ? (
            <span class="tool-file-link" onClick={() => openFile(filePath)} title="Open in editor">{content}</span>
          ) : content}
        </pre>
      )}
    </ChatMessage>
  );
}

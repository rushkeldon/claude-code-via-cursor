import './ChatMessage.less';
import { ComponentChildren } from 'preact';
import { CopyButton } from '../CopyButton/CopyButton';

interface ChatMessageProps {
  type: 'user' | 'claude' | 'error' | 'system' | 'tool' | 'tool-result' | 'thinking';
  icon?: string;
  label?: string;
  showHeader?: boolean;
  // Category accent (tool messages). Applies `cat-<accent>` on the root, which
  // sets --tool-accent-a/b CSS vars; both the left accent border (::before, same
  // element) and the descendant .tool-icon read those vars, so they always match.
  accent?: string;
  // Raw text the header copy button should put on the clipboard. Pass the original
  // markdown source (e.g. a Claude response) so copy yields literal `**bold**`,
  // `# headings`, fenced blocks — not the DOM's flattened textContent. When
  // omitted, falls back to reading rendered .message-content text.
  copyText?: string;
  children: ComponentChildren;
}

export function ChatMessage({ type, icon, label, showHeader = true, accent, copyText, children }: ChatMessageProps) {
  let messageRef: HTMLDivElement | null = null;

  // Prefer the raw markdown source (preserves **bold**, headings, code fences).
  // Fall back to the rendered text when no source was provided.
  const copyWholeMessage = () =>
    copyText ?? messageRef?.querySelector('.message-content')?.textContent ?? '';

  return (
    <div class={`message ${type}${accent ? ` cat-${accent}` : ''}`} ref={(el) => { messageRef = el; }}>
      {showHeader && icon && label && (
        <div class="message-header">
          <div class={`message-icon ${type}`}>{icon}</div>
          <div class="message-label">{label}</div>
          <CopyButton text={copyWholeMessage} title="Copy message" class="copy-btn" />
        </div>
      )}
      <div class="message-content">{children}</div>
    </div>
  );
}

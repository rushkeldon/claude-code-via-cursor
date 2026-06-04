import './ChatMessage.less';
import { ComponentChildren } from 'preact';

interface ChatMessageProps {
  type: 'user' | 'claude' | 'error' | 'system' | 'tool' | 'tool-result' | 'thinking';
  icon?: string;
  label?: string;
  showHeader?: boolean;
  children: ComponentChildren;
}

function copyMessageContent(el: HTMLElement | null) {
  if (!el) return;
  const content = el.querySelector('.message-content');
  if (content) {
    navigator.clipboard.writeText(content.textContent || '');
  }
}

export function ChatMessage({ type, icon, label, showHeader = true, children }: ChatMessageProps) {
  let messageRef: HTMLDivElement | null = null;

  return (
    <div class={`message ${type}`} ref={(el) => { messageRef = el; }}>
      {showHeader && icon && label && (
        <div class="message-header">
          <div class={`message-icon ${type}`}>{icon}</div>
          <div class="message-label">{label}</div>
          <button
            class="copy-btn"
            type="button"
            title="Copy message"
            onClick={() => copyMessageContent(messageRef)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
        </div>
      )}
      <div class="message-content">{children}</div>
    </div>
  );
}

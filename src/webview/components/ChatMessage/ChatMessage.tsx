import './ChatMessage.less';
import { ComponentChildren } from 'preact';
import { CopyButton } from '../CopyButton/CopyButton';
import { useCollapsible } from '../Collapsible/useCollapsible';

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
  // Collapse support. `collapsible` (default true) adds a ▸/▾ chevron toggle;
  // `initialDisplayed` (default true) sets the starting state — true = open.
  // Set collapsible={false} to opt a card out entirely.
  collapsible?: boolean;
  initialDisplayed?: boolean;
  children: ComponentChildren;
}

export function ChatMessage({
  type,
  icon,
  label,
  showHeader = true,
  accent,
  copyText,
  collapsible = true,
  initialDisplayed = true,
  children,
}: ChatMessageProps) {
  let messageRef: HTMLDivElement | null = null;
  const { displayed, toggle, chevron } = useCollapsible(initialDisplayed);

  // Prefer the raw markdown source (preserves **bold**, headings, code fences).
  // Fall back to the rendered text when no source was provided.
  const copyWholeMessage = () =>
    copyText ?? messageRef?.querySelector('.message-content')?.textContent ?? '';

  // Collapse is offered ONLY through a real header — a card with no header (or no
  // collapsible content) gets no chevron, so there's never a toggle that opens/
  // closes nothing. Headerless cards (showHeader={false}) render their content
  // plainly and are not collapsible at the ChatMessage level (e.g. ToolMessage
  // owns its own collapse on its tool-header).
  const hasHeader = showHeader && !!icon && !!label;
  const canCollapse = collapsible && hasHeader;
  const contentDisplayed = canCollapse ? displayed : true;

  return (
    <div class={`message ${type}${accent ? ` cat-${accent}` : ''}`} ref={(el) => { messageRef = el; }}>
      {hasHeader && (
        <div
          class={`message-header${canCollapse ? ' message-header--toggle' : ''}`}
          onClick={canCollapse ? toggle : undefined}
          role={canCollapse ? 'button' : undefined}
          title={canCollapse ? (displayed ? 'Collapse' : 'Expand') : undefined}
        >
          {canCollapse && chevron}
          {/* Card icons removed by request — the left-edge color accent + the
              label word are enough to identify a card; the icon read as clutter.
              Kept (commented) so it's a one-line revert. The `icon` prop is still
              passed by callers and still gates `hasHeader`, so headers render. */}
          {/* <div class={`message-icon ${type}`}>{icon}</div> */}
          <div class="message-label">{label}</div>
          {/* stopPropagation so copying doesn't also toggle the collapse. The
              margin-left:auto lives on the wrapper so the button stays flush
              right (putting it on the inner button would only shift it within
              the wrapper). */}
          <span class="copy-btn-wrap" onClick={(e) => e.stopPropagation()}>
            <CopyButton text={copyWholeMessage} title="Copy message" />
          </span>
        </div>
      )}
      {contentDisplayed && <div class="message-content">{children}</div>}
    </div>
  );
}

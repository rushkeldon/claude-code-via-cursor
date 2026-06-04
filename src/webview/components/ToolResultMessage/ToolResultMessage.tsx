import './ToolResultMessage.less';
import { useState } from 'preact/hooks';
import { post } from '../../vscode';

interface ToolResultMessageProps {
  content: string;
}

export function ToolResultMessage({ content }: ToolResultMessageProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const lineCount = content.split('\n').length;
  const preview = content.length > 80 ? content.slice(0, 80) + '...' : content;

  function handleCopy(e: Event) {
    e.stopPropagation();
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      post({ type: 'copyToClipboard', text: content } as any);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div
      class={`tool-result-message ${expanded ? 'tool-result-message--expanded' : ''}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div class="tool-result-header">
        <span class="tool-result-chevron">{expanded ? '▾' : '▸'}</span>
        <span class="tool-result-label">Result</span>
        {!expanded && <span class="tool-result-preview">{preview}</span>}
        {lineCount > 1 && <span class="tool-result-meta">{lineCount} lines</span>}
        <button class="tool-result-copy-btn" type="button" title="Copy" onClick={handleCopy}>
          {copied
            ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>}
        </button>
      </div>
      {expanded && (
        <pre class="tool-result-content">{content}</pre>
      )}
    </div>
  );
}

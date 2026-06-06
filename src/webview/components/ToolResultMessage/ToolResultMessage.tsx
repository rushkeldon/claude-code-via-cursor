import './ToolResultMessage.less';
import { useState } from 'preact/hooks';
import { CopyButton } from '../CopyButton/CopyButton';

interface ToolResultMessageProps {
  content: string;
}

export function ToolResultMessage({ content }: ToolResultMessageProps) {
  const [expanded, setExpanded] = useState(false);

  const lineCount = content.split('\n').length;
  const preview = content.length > 80 ? content.slice(0, 80) + '...' : content;

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
        <CopyButton text={content} class="tool-result-copy-btn" />
      </div>
      {expanded && (
        <pre class="tool-result-content">{content}</pre>
      )}
    </div>
  );
}

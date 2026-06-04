import './ThinkingPill.less';
import { useState } from 'preact/hooks';

interface ThinkingPillProps {
  content: string;
  elapsedLabel: string;
}

export function ThinkingPill({ content, elapsedLabel }: ThinkingPillProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div class="thinking-pill">
      <button
        class="thinking-pill-summary"
        type="button"
        onClick={() => setExpanded(!expanded)}
      >
        <span class="thinking-pill-chevron">{expanded ? '▾' : '▸'}</span>
        <span class="thinking-pill-icon">💭</span>
        <span class="thinking-pill-label">Thought for {elapsedLabel}</span>
      </button>
      {expanded && (
        <div class="thinking-pill-content">{content}</div>
      )}
    </div>
  );
}

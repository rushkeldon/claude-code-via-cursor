import './ThinkingPill.less';
import { useState } from 'preact/hooks';

interface ThinkingPillProps {
  content: string;
  elapsedLabel: string;
}

export function ThinkingPill({ content, elapsedLabel }: ThinkingPillProps) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!content && !!content.trim();

  // Timer-only pill: a thinking block occurred but produced no thought text. Not
  // expandable, and shows no note — the absence of an expand chevron already
  // tells the user there's nothing to see, so a "no thoughts" line is just noise.
  if (!hasContent) {
    return (
      <div class="thinking-pill thinking-pill--empty">
        <span class="thinking-pill-icon">💭</span>
        <span class="thinking-pill-label">Thought for {elapsedLabel}</span>
      </div>
    );
  }

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

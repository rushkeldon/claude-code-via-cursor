import './ThinkingPill.less';
import { useState } from 'preact/hooks';

interface ThinkingPillProps {
  content: string;
  elapsedLabel: string;
  noThoughts?: boolean;
}

export function ThinkingPill({ content, elapsedLabel, noThoughts }: ThinkingPillProps) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!content && !!content.trim();

  // Timer-only pill: a thinking block occurred but produced no thought text. Not
  // expandable; shows an honest note so an empty Thoughts toggle reads as
  // informative rather than broken.
  if (!hasContent) {
    return (
      <div class="thinking-pill thinking-pill--empty">
        <span class="thinking-pill-icon">💭</span>
        <span class="thinking-pill-label">Thought for {elapsedLabel}</span>
        {noThoughts && (
          <span class="thinking-pill-note">· no thoughts returned for this model/provider</span>
        )}
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

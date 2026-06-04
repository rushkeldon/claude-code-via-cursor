import './DroppedFile.less';
import { useState } from 'preact/hooks';

interface DroppedFileProps {
  filePath: string;
  contents: string;
  language: string;
  onRemove: () => void;
}

export function DroppedFile({ filePath, contents, language, onRemove }: DroppedFileProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = contents.split('\n');
  const preview = lines.slice(0, 2).join('\n');
  const hasMore = lines.length > 2;

  return (
    <div class="dropped-file">
      <div class="dropped-file-header">
        <span class="dropped-file-chevron" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▾' : '▸'}
        </span>
        <span class="dropped-file-path" onClick={() => setExpanded(!expanded)}>{filePath}</span>
        <span class="dropped-file-meta">{lines.length} lines</span>
        <button class="dropped-file-remove" type="button" onClick={onRemove}>×</button>
      </div>
      <div class={`dropped-file-code ${expanded ? 'dropped-file-code--expanded' : ''}`} onClick={() => !expanded && setExpanded(true)}>
        <pre><code>{expanded ? contents : (preview + (hasMore ? '\n...' : ''))}</code></pre>
      </div>
    </div>
  );
}

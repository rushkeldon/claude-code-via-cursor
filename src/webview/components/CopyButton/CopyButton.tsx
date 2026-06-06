import './CopyButton.less';
import { useState } from 'preact/hooks';
import { post } from '../../vscode';

interface CopyButtonProps {
  // The text to place on the clipboard. Can be a string or a getter (deferred —
  // useful when the content is read from the DOM at click time, e.g. a code block).
  text: string | (() => string);
  title?: string;
  // Extra class for positioning/context (e.g. 'code-block-copy-btn'). The base
  // .copy-button styling (size, hover, copied state) always applies.
  class?: string;
}

const ICON_COPY = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg>
);
const ICON_DONE = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
);

// Single shared copy button. Owns the clipboard write (with the host-side
// postMessage fallback for environments where navigator.clipboard is blocked)
// and the ✓-for-1.5s "copied" confirmation. Use everywhere instead of bespoke
// per-component copy buttons so size/look/behavior stay consistent.
export function CopyButton({ text, title = 'Copy', class: extraClass }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: Event) {
    e.stopPropagation();
    const value = typeof text === 'function' ? text() : text;
    if (!value) return;
    const flash = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    navigator.clipboard.writeText(value).then(flash).catch(() => {
      post({ type: 'copyToClipboard', text: value } as any);
      flash();
    });
  }

  return (
    <button
      class={`copy-button${extraClass ? ` ${extraClass}` : ''}`}
      type="button"
      title={title}
      onClick={handleCopy}
    >
      {copied ? ICON_DONE : ICON_COPY}
    </button>
  );
}

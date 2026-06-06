import './StallHint.less';
import { signal } from '@preact/signals';
import { on } from '../../vscode';

const stallMessage = signal<string | null>(null);

on('processStalled' as any, (msg: any) => {
  const seconds = Math.round((msg.data?.sinceLastMs || 0) / 1000);
  stallMessage.value = `Claude has been silent for ${seconds}s. It may be processing a large response.`;
});

on('stallHintClear' as any, () => {
  stallMessage.value = null;
});

on('setProcessing' as any, (msg: any) => {
  if (!msg.data?.isProcessing) {
    stallMessage.value = null;
  }
});

export function StallHint() {
  const message = stallMessage.value;
  if (!message) return null;

  return (
    <div class="stall-hint">
      <span class="stall-hint-icon">⏳</span>
      <span class="stall-hint-text">{message}</span>
      {/* Per-occurrence dismiss. The stall hint is often a false positive the
          user already knows about — let them clear it immediately. A later
          processStalled re-sets stallMessage, so a fresh stall can show again. */}
      <button
        class="stall-hint-close"
        type="button"
        title="Dismiss"
        aria-label="Dismiss"
        onClick={() => { stallMessage.value = null; }}
      >
        ✕
      </button>
    </div>
  );
}

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
      <span>{message}</span>
    </div>
  );
}

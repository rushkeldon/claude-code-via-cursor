import './SessionStatus.less';
import { signal, computed } from '@preact/signals';
import { on } from '../../vscode';
import { tokenState } from '../../state/tokens';

type StatusState = 'ready' | 'processing' | 'error' | 'disconnected';

const statusState = signal<StatusState>('disconnected');
const requestStartTime = signal<number | null>(null);
const elapsedSeconds = signal(0);

let elapsedTimer: number | undefined;

function startElapsedTimer() {
  requestStartTime.value = Date.now();
  elapsedSeconds.value = 0;
  clearInterval(elapsedTimer);
  elapsedTimer = window.setInterval(() => {
    if (requestStartTime.value) {
      elapsedSeconds.value = Math.floor((Date.now() - requestStartTime.value) / 1000);
    }
  }, 1000);
}

function stopElapsedTimer() {
  clearInterval(elapsedTimer);
  elapsedTimer = undefined;
  requestStartTime.value = null;
}

on('setProcessing' as any, (msg: any) => {
  if (msg.data?.isProcessing) {
    statusState.value = 'processing';
    startElapsedTimer();
  } else {
    stopElapsedTimer();
    statusState.value = 'ready';
  }
});

on('ready', () => {
  statusState.value = 'ready';
});

on('authError' as any, () => {
  statusState.value = 'error';
});

const displayText = computed(() => {
  const state = statusState.value;
  const tokens = tokenState.value;
  const totalTokens = tokens.totalInput + tokens.totalOutput;
  const elapsed = elapsedSeconds.value;

  if (state === 'processing') {
    const tokensStr = totalTokens > 0 ? `${totalTokens.toLocaleString()} tokens` : '0 tokens';
    const elapsedStr = elapsed > 0 ? `${elapsed}s` : '';
    return `Processing • ${tokensStr}${elapsedStr ? ` • ${elapsedStr}` : ''}`;
  }

  if (state === 'error') {
    return 'Authentication Error';
  }

  if (state === 'disconnected') {
    return 'Initializing...';
  }

  const parts: string[] = ['Ready'];
  if (totalTokens > 0) {
    parts.push(`${totalTokens.toLocaleString()} tokens`);
  }
  if (tokens.requestCount > 0) {
    parts.push(`${tokens.requestCount} requests`);
  }
  if (tokens.totalCost > 0) {
    parts.push(`$${tokens.totalCost.toFixed(2)}`);
  }
  return parts.join(' • ');
});

export function SessionStatus() {
  const state = statusState.value;

  return (
    <div class={`session-status ${state}`}>
      <div class="session-status-indicator"></div>
      <div class="session-status-text">{displayText.value}</div>
    </div>
  );
}

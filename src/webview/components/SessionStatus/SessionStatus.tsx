import './SessionStatus.less';
import { signal, computed } from '@preact/signals';
import { on } from '../../vscode';
import { tokenState, contextUsage } from '../../state/tokens';

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

// Color class keyed off the % of the WINDOW (Cursor-style "getting full"),
// independent of whether auto-compact is enabled: amber at 80%, red at 90%.
function ctxClass(percentage: number): string {
  if (percentage >= 90) { return 'session-status-ctx ctx--full'; }
  if (percentage >= 80) { return 'session-status-ctx ctx--warn'; }
  return 'session-status-ctx';
}

export function SessionStatus() {
  const state = statusState.value;
  const cu = contextUsage.value;

  // Show the ctx chip on both the Ready and Processing lines, but only once we
  // have a real reading (hide entirely until the first get_context_usage). It's
  // stale mid-turn — always-visible is preferred over flicker.
  const showCtx = !!cu && cu.maxTokens > 0 && (state === 'ready' || state === 'processing');

  return (
    <div class={`session-status ${state}`}>
      <div class="session-status-indicator"></div>
      <div class="session-status-text">{displayText.value}</div>
      {showCtx && cu && (
        <div class={ctxClass(cu.percentage)}>
          ctx {cu.percentage}%
          <div class="session-status-ctx-tooltip">
            <div class="session-status-ctx-tooltip-total">
              {cu.totalTokens.toLocaleString()} / {cu.maxTokens.toLocaleString()} tokens
              {cu.isAutoCompactEnabled && cu.autoCompactThreshold > 0 && (
                <span> · auto-compact at {cu.autoCompactThreshold.toLocaleString()}</span>
              )}
            </div>
            {cu.categories.map((c) => (
              <div class="session-status-ctx-tooltip-row" key={c.name}>
                <span class="session-status-ctx-tooltip-name">{c.name}</span>
                <span class="session-status-ctx-tooltip-tokens">{c.tokens.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

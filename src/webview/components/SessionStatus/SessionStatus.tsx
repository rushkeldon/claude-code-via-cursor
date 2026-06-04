import './SessionStatus.less';
import { signal, computed } from '@preact/signals';
import { on, post } from '../../vscode';
import { processing, resolvedModel, modelFull } from '../../state/session';
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

// Lines for the hover tooltip over the model name. Shows the full provider string.
// When the configured default and the runtime env override disagree, both are
// surfaced (labeled) so the tooltip never misrepresents what's actually serving.
const tooltipLines = computed<{ label?: string; value: string }[]>(() => {
  const { configured, resolvedEnv } = modelFull.value;
  const short = resolvedModel.value;

  if (configured && resolvedEnv && configured !== resolvedEnv) {
    return [
      { label: 'configured', value: configured },
      { label: 'running', value: resolvedEnv },
    ];
  }

  const full = configured || resolvedEnv;
  // Only worth a tooltip if there's more than the short label already shows.
  if (full && full !== short) {
    return [{ value: full }];
  }
  return [];
});

export function SessionStatus() {
  const state = statusState.value;
  const lines = tooltipLines.value;

  return (
    <div class={`session-status ${state}`}>
      <div class="session-status-indicator"></div>
      <div class="session-status-text">{displayText.value}</div>
      <div class="session-status-model">
        <span class="session-status-model-label">{resolvedModel.value}</span>
        {lines.length > 0 && (
          <div class="session-status-model-tooltip">
            {lines.map(l => (
              <div class="session-status-model-tooltip-line">
                {l.label && <span class="session-status-model-tooltip-label">{l.label}: </span>}
                {l.value}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

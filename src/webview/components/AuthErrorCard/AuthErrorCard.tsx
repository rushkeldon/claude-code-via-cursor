import './AuthErrorCard.less';
import { signal } from '@preact/signals';
import { on, post } from '../../vscode';

type ApiErrorCategory = 'auth' | 'rate-limit' | 'bad-request' | 'server' | 'client';

interface ApiErrorState {
  category: ApiErrorCategory;
  code?: number;
  detail?: string;
}

const apiError = signal<ApiErrorState | null>(null);

on('apiError' as any, (msg: any) => {
  apiError.value = {
    category: (msg.data?.category as ApiErrorCategory) || 'client',
    code: msg.data?.code,
    detail: msg.data?.detail,
  };
});

// A turn starting (setProcessing → true) means we've recovered — clear the card.
on('setProcessing', (msg: any) => {
  if (msg.data?.isProcessing) apiError.value = null;
});

// Per-category copy. Respawn is offered for everything except bad-request, where
// re-sending the identical (e.g. too-long) turn would just fail again.
const COPY: Record<ApiErrorCategory, { icon: string; title: string; body: string; offersRespawn: boolean }> = {
  auth: {
    icon: '🔐',
    title: 'Authentication expired',
    body: 'Your credentials appear to be expired or invalid. Refresh your authentication in a terminal (e.g. “claude login” or “aws sso login”), then click Respawn.',
    offersRespawn: true,
  },
  'rate-limit': {
    icon: '⏳',
    title: 'Rate limited',
    body: "You've hit a rate limit. Wait a moment, then click Respawn.",
    offersRespawn: true,
  },
  'bad-request': {
    icon: '⚠️',
    title: 'Request rejected',
    body: 'The request was rejected by the API. This often means the conversation is too long for the model — try a new session or trimming context.',
    offersRespawn: false,
  },
  server: {
    icon: '☁️',
    title: 'Service unavailable',
    body: 'The API is temporarily unavailable or overloaded. Click Respawn to retry.',
    offersRespawn: true,
  },
  client: {
    icon: '⚠️',
    title: 'Request error',
    body: 'The API returned an error. Click Respawn to retry.',
    offersRespawn: true,
  },
};

export function AuthErrorCard() {
  const error = apiError.value;
  if (!error) return null;

  const copy = COPY[error.category];
  const titleSuffix = error.code ? ` (${error.code})` : '';

  return (
    <div class="auth-error-card">
      <div class="auth-error-header">
        <span class="auth-error-icon">{copy.icon}</span>
        <span class="auth-error-title">{copy.title}{titleSuffix}</span>
      </div>
      <div class="auth-error-body">
        <p>{copy.body}</p>
      </div>
      {error.detail && (
        <details class="auth-error-detail">
          <summary>Details</summary>
          <pre>{error.detail}</pre>
        </details>
      )}
      <div class="auth-error-actions">
        {copy.offersRespawn && (
          <button
            class="auth-error-btn auth-error-btn-primary"
            type="button"
            onClick={() => { apiError.value = null; post({ type: 'respawn' } as any); }}
          >
            Respawn
          </button>
        )}
        <button
          class="auth-error-btn"
          type="button"
          onClick={() => post({ type: 'openTerminal' } as any)}
        >
          Open Terminal
        </button>
      </div>
    </div>
  );
}

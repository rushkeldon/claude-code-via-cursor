import './AuthErrorCard.less';
import { signal } from '@preact/signals';
import { on, post } from '../../vscode';

const authError = signal<{ message: string; detail?: string } | null>(null);

on('authError' as any, (msg: any) => {
  authError.value = { message: 'Authentication required', detail: msg.data?.rawError };
});

export function AuthErrorCard() {
  const error = authError.value;
  if (!error) return null;

  return (
    <div class="auth-error-card">
      <div class="auth-error-header">
        <span class="auth-error-icon">🔐</span>
        <span class="auth-error-title">Authentication Required</span>
      </div>
      <div class="auth-error-body">
        <p>Claude Code requires authentication. Open a terminal and run:</p>
        <p><code>claude login</code></p>
      </div>
      {error.detail && (
        <details class="auth-error-detail">
          <summary>Details</summary>
          <pre>{error.detail}</pre>
        </details>
      )}
      <div class="auth-error-actions">
        <button
          class="auth-error-btn auth-error-btn-primary"
          type="button"
          onClick={() => post({ type: 'openTerminal' } as any)}
        >
          Open Terminal
        </button>
        <button
          class="auth-error-btn"
          type="button"
          onClick={() => post({ type: 'reloadWindow' } as any)}
        >
          Reload Window
        </button>
      </div>
    </div>
  );
}

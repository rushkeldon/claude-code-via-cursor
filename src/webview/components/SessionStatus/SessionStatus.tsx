import './SessionStatus.less';
import { signal, computed } from '@preact/signals';
import { on } from '../../vscode';
import { tokenState, contextUsage } from '../../state/tokens';

// The single value the indicator renders, folded by the resolver below from two
// independent inputs: the turn-activity state (event-driven heartbeat from the
// host's turn-health monitor) and the process-lifecycle state (spawn/ready/auth/
// park — already event-driven). There is NO wall-clock anywhere: 'quiet' is not a
// stall verdict, it's "no output right now," shown honestly (pulse absent).
type StatusState = 'ready' | 'working' | 'quiet' | 'opening' | 'error' | 'disconnected';

// Mirrors turnHealth.ts. 'idle' = no open turn (the resolver reads it as ready).
type TurnState = 'opening' | 'active' | 'quiet' | 'done' | 'errored' | 'idle';
type ActivityKind = 'thinking' | 'text' | 'tool' | 'compacting';

// ── Resolver inputs ─────────────────────────────────────────────────────────
// process warm? (got the init handshake `ready`, or any turn activity since)
const procConnected = signal(false);
// auth handshake failed — sticky until a fresh turn/ready clears it
const authFailed = signal(false);
// latest turn-activity state + what kind of heartbeat is flowing
const turn = signal<TurnState>('idle');
const turnKind = signal<ActivityKind | undefined>(undefined);

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

// setProcessing still brackets the turn (Send → result) and is the reliable
// signal for the elapsed timer. The richer within-turn state comes from
// turnActivity below; this just bounds the clock and proves the process is live.
on('setProcessing' as any, (msg: any) => {
  if (msg.data?.isProcessing) {
    procConnected.value = true;
    authFailed.value = false;
    startElapsedTimer();
  } else {
    stopElapsedTimer();
    // Turn bracket closed — fall back to idle. A trailing turnActivity 'done'
    // arrives just before this and also resolves to ready, so they agree.
    // EXCEPTION: don't clobber an 'errored' turn — the host fires turnActivity
    // 'errored' immediately before this setProcessing(false), and we want the
    // error to stay on the indicator until the next turn starts (cleared by the
    // 'opening'/'active' or processing-true paths).
    if (turn.value !== 'errored') {
      turn.value = 'idle';
      turnKind.value = undefined;
    }
  }
});

// The heartbeat. Each transition from the host's turn-health monitor lands here:
// opening (benign pre-first-token) / active (pulse) / quiet (no bytes right now,
// debounced — NOT a stall) / done / errored. Any activity also proves the process
// is alive, so it clears the disconnected/auth state.
on('turnActivity' as any, (msg: any) => {
  const state = msg.data?.state as TurnState | undefined;
  if (!state) { return; }
  turn.value = state;
  turnKind.value = msg.data?.kind;
  procConnected.value = true;
  if (state === 'opening' || state === 'active') {
    authFailed.value = false;
  }
});

on('ready', () => {
  procConnected.value = true;
  authFailed.value = false;
});

on('apiError' as any, () => {
  authFailed.value = true;
});

// Skull (hard kill) parks the session — the process is gone until the next turn
// lazily respawns. Drop back to disconnected so the indicator reads honestly.
on('sessionParked' as any, () => {
  procConnected.value = false;
  turn.value = 'idle';
  turnKind.value = undefined;
});

// ── The resolver ─────────────────────────────────────────────────────────────
// Folds process-lifecycle + turn-activity into one indicator state. Precedence
// matches doc/archive/health_monitor.plan.md: dead → auth → turn-error → active
// → opening/quiet → ready.
const statusState = computed<StatusState>(() => {
  if (authFailed.value) { return 'error'; }
  if (!procConnected.value) { return 'disconnected'; }
  switch (turn.value) {
    case 'errored': return 'error';
    case 'active': return 'working';
    case 'opening': return 'opening';
    case 'quiet': return 'quiet';
    default: return 'ready';   // 'done' | 'idle'
  }
});

// What kind of work is flowing, in calm, factual words — never a "too long"
// judgment. Free now that the host surfaces every heartbeat (thinking, text,
// tool-arg assembly, compacting), not just thinking.
function kindLabel(kind: ActivityKind | undefined): string {
  switch (kind) {
    case 'thinking': return 'Thinking';
    case 'text': return 'Responding';
    case 'tool': return 'Using tools';
    case 'compacting': return 'Compacting';
    default: return 'Working';
  }
}

const displayText = computed(() => {
  const state = statusState.value;
  const tokens = tokenState.value;
  const totalTokens = tokens.totalInput + tokens.totalOutput;
  const elapsed = elapsedSeconds.value;
  const elapsedStr = elapsed > 0 ? ` • ${elapsed}s` : '';

  if (state === 'disconnected') {
    return 'Initializing…';
  }

  if (state === 'error') {
    // An auth handshake failure is distinct from a turn that errored out.
    return authFailed.value ? 'Authentication Error' : 'Turn ended with an error';
  }

  if (state === 'opening') {
    // Benign pre-first-token window — looks like work, never like a stall.
    return `Starting…${elapsedStr}`;
  }

  if (state === 'working' || state === 'quiet') {
    // 'working' and 'quiet' read identically in words — the ONLY difference is
    // the dot (pulsing vs steady). The steady dot means "no output right now,"
    // honest information, not an alarm.
    const tokensStr = totalTokens > 0 ? ` • ${totalTokens.toLocaleString()} tokens` : '';
    return `${kindLabel(turnKind.value)}${tokensStr}${elapsedStr}`;
  }

  // ready
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

// States that count as "a turn is live" for showing the ctx chip (it's stale
// mid-turn but always-visible beats flicker).
const LIVE_STATES: StatusState[] = ['working', 'quiet', 'opening'];

export function SessionStatus() {
  const state = statusState.value;
  const cu = contextUsage.value;

  const showCtx = !!cu && cu.maxTokens > 0 && (state === 'ready' || LIVE_STATES.includes(state));

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

import './ModelSelector.less';
import { useState, useRef, useEffect } from 'preact/hooks';
import { post } from '../../vscode';
import { modelConfig, modelList, selectedModel, pendingModel } from '../../state/settings';

// Produce a compact label from a full model id for the status-bar chip.
// e.g. "us.anthropic.claude-opus-4-8[1m]" → "opus-4-8", "claude-sonnet-4-6" → "sonnet-4-6".
function shortLabel(model: string): string {
  let s = model.replace(/\[.*\]$/, ''); // drop the [1m] context tag
  s = s.split('/').pop() || s; // drop any provider path prefix
  const m = s.match(/(opus|sonnet|haiku)[-\d.]*/i);
  if (m) return m[0];
  const dot = s.split('.').pop() || s; // drop region/provider dotted prefix
  return dot.replace(/^claude-/, '');
}

let listRequested = false;

export function ModelSelector() {
  const cfg = modelConfig.value;
  const list = modelList.value;
  const selected = selectedModel.value;
  const pending = pendingModel.value;
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the menu when the user clicks or focuses anything outside it
  // (e.g. the prompt input). mousedown covers clicks; focusin covers tabbing.
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('focusin', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('focusin', close);
    };
  }, [open]);

  if (!cfg) {
    post({ type: 'getModelConfig' });
  }
  // Pull the dynamic list once; it arrives after the first spawn's handshake.
  if (!listRequested) {
    listRequested = true;
    post({ type: 'getModelList' });
  }

  // The value to display: the in-band selection if known, else the configured
  // model, else the global default, else a prompt.
  const current = selected || cfg?.model || cfg?.globalDefault;
  const label = current ? shortLabel(current) : 'Set model';
  const title = pending
    ? `Switching to ${pending} on the next turn — click to change`
    : current
      ? `Model: ${current} — click to change`
      : 'No model configured — click to set one';

  function choose(value: string) {
    const v = value.trim();
    if (!v) return;
    // In-band switch via the control protocol. Gated on idle: while a turn is
    // in flight the switch is deferred extension-side and applied at the next
    // turn-end — the picker stays open/usable and shows a "next turn" marker.
    post({ type: 'setModelInband', model: v } as any);
    setOpen(false);
    setCustom('');
  }

  return (
    <div class="model-selector-row" ref={rootRef}>
      <button
        class={`model-dropdown-btn${pending ? ' pending' : ''}`}
        type="button"
        onClick={() => setOpen(!open)}
        title={title}
      >
        <span class="model-dropdown-text">{label}</span>
        {pending && <span class="model-dropdown-pending" title={`${pending} applies next turn`}>⏱</span>}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M1 2.5l3 3 3-3"></path></svg>
      </button>

      {open && (
        <div class="model-picker" role="listbox">
          {list.length === 0 && (
            <div class="model-picker-empty">No models yet — send a message first to load the list, or type an id below.</div>
          )}
          {list.map((m) => {
            const isPending = pending === m.value;
            const isSel = !pending && current === m.value;
            return (
              <button
                key={m.value}
                class={`model-picker-item${isSel ? ' selected' : ''}${isPending ? ' pending' : ''}`}
                type="button"
                onClick={() => choose(m.value)}
                title={m.value}
              >
                <span class="model-picker-item-label">{m.displayName || m.value}</span>
                {m.description && <span class="model-picker-item-desc">{m.description}</span>}
                {isPending && <span class="model-picker-item-pending">next turn</span>}
                {isSel && <span class="model-picker-item-check">✓</span>}
              </button>
            );
          })}
          <div class="model-picker-custom">
            <input
              class="model-picker-custom-input"
              type="text"
              placeholder="Custom model id (e.g. us.anthropic.…)"
              value={custom}
              onInput={(e) => setCustom((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') choose(custom); }}
            />
            <button
              class="model-picker-custom-apply"
              type="button"
              onClick={() => choose(custom)}
              disabled={!custom.trim()}
            >Use</button>
          </div>
        </div>
      )}
    </div>
  );
}

import './EffortPicker.less';
import { useState, useEffect, useRef } from 'preact/hooks';
import { post } from '../../vscode';
import { modelList, selectedModel, modelConfig, effort } from '../../state/settings';

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Effort (thinking depth) picker. Options come from the selected model's
// advertised supportedEffortLevels (gate #2). Hidden for models that don't
// advertise supportsEffort (alias/legacy entries carry no flags). Changing the
// effort applies on the next turn (the host respawns to re-inject --settings).
export function EffortPicker() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the menu when the user clicks or focuses outside it (e.g. the prompt
  // input). mousedown covers clicks; focusin covers tabbing.
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

  const cfg = modelConfig.value;
  const current = selectedModel.value || cfg?.model || cfg?.globalDefault;
  const entry = modelList.value.find((m) => m.value === current);
  const levels = entry?.supportsEffort ? (entry.supportedEffortLevels || []) : [];

  // Clamp a stale effort that isn't valid for the newly-selected model
  // (e.g. xhigh on Opus → Sonnet has no xhigh). Converges: the host echoes the
  // clamped value back via thoughtControlConfig, after which it's in `levels`.
  useEffect(() => {
    const e = effort.value;
    if (e && levels.length > 0 && !levels.includes(e)) {
      const fallback = levels.includes('high') ? 'high' : levels[levels.length - 1];
      post({ type: 'setEffort', level: fallback });
    }
  }, [current, levels.join(','), effort.value]);

  if (!entry?.supportsEffort || levels.length === 0) return null;

  const shown = effort.value && levels.includes(effort.value) ? effort.value : undefined;
  const label = shown ? cap(shown) : 'Effort';

  function choose(level: string) {
    post({ type: 'setEffort', level });
    setOpen(false);
  }

  return (
    <div class="effort-picker" ref={rootRef}>
      <button
        class="effort-btn"
        type="button"
        title={shown ? `Effort: ${shown} — applies next turn` : 'Thinking effort (model default) — click to set'}
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M1 2.5l3 3 3-3"></path></svg>
      </button>
      {open && (
        <div class="effort-menu" role="listbox">
          {levels.map((l) => (
            <button
              key={l}
              class={`effort-item${shown === l ? ' selected' : ''}`}
              type="button"
              onClick={() => choose(l)}
            >
              <span>{cap(l)}</span>
              {shown === l && <span class="effort-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

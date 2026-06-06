import './ThoughtsToggle.less';
import { post } from '../../vscode';
import { modelList, selectedModel, modelConfig, thoughtsOn } from '../../state/settings';

// Thoughts visibility toggle (On = summarized thought text shown, Off = hidden).
// Thinking stays on in both — this only controls whether the summary text renders
// below the always-on thinking bubble. Hidden for non-adaptive models (no flag).
// Applies on the next turn (host respawns to re-inject --settings).
export function ThoughtsToggle() {
  const cfg = modelConfig.value;
  const current = selectedModel.value || cfg?.model || cfg?.globalDefault;
  const entry = modelList.value.find((m) => m.value === current);

  if (!entry?.supportsAdaptiveThinking) return null;

  const on = thoughtsOn.value;
  return (
    <button
      class={`thoughts-toggle${on ? ' active' : ''}`}
      type="button"
      title={
        on
          ? 'Thoughts shown (summarized) — applies next turn'
          : 'Thoughts hidden (the model still thinks; bubble + timer still show) — applies next turn'
      }
      onClick={() => post({ type: 'setThoughtsDisplay', on: !on })}
    >
      Thoughts: {on ? 'On' : 'Off'}
    </button>
  );
}

import './ModelSelector.less';
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { on, post } from '../../vscode';

const currentModel = signal('opus');
const dropdownOpen = signal(false);

on('modelSwitching' as any, (msg: any) => {
  if (msg.data?.model || msg.model) {
    currentModel.value = msg.data?.model || msg.model;
  }
});

on('modelSwitched' as any, (msg: any) => {
  if (msg.data?.model || msg.model) {
    currentModel.value = msg.data?.model || msg.model;
  }
});

const MODELS = [
  { id: 'opus', label: 'Opus', description: 'Most capable' },
  { id: 'sonnet', label: 'Sonnet', description: 'Fast + capable' },
  { id: 'haiku', label: 'Haiku', description: 'Fastest' },
];

function getModelLabel(model: string): string {
  const found = MODELS.find(m => m.id === model);
  if (found) return found.label;
  if (model === 'default') return 'Opus';
  const words = model.split(/[\s/\-]+/);
  return words.slice(0, 2).join(' ');
}

function selectModel(modelId: string) {
  post({ type: 'selectModel', model: modelId } as any);
  currentModel.value = modelId;
  dropdownOpen.value = false;
}

export function ModelSelector() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen.value) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        dropdownOpen.value = false;
      }
    }
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [dropdownOpen.value]);

  return (
    <div class="model-selector-row" ref={containerRef}>
      <button
        class="model-dropdown-btn"
        type="button"
        onClick={() => { dropdownOpen.value = !dropdownOpen.value; }}
        title="Select model"
      >
        <span class="model-dropdown-text">{getModelLabel(currentModel.value)}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M1 2.5l3 3 3-3"></path></svg>
      </button>
      {dropdownOpen.value && (
        <div class="model-picker">
          {MODELS.map(m => (
            <button
              class={`model-picker-item${currentModel.value === m.id ? ' selected' : ''}`}
              type="button"
              key={m.id}
              onClick={() => selectModel(m.id)}
            >
              <span class="model-picker-item-label">{m.label}</span>
              <span class="model-picker-item-desc">{m.description}</span>
              {currentModel.value === m.id && <span class="model-picker-item-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

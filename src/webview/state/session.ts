import { signal } from '@preact/signals';
import { on } from '../vscode';

export const sessionId = signal<string | null>(null);
export const processing = signal(false);
export const resolvedModel = signal<string>('opus');

// Full provider-qualified model string(s) for the status-bar hover tooltip.
// `configured` is the top-level `model` in ~/.claude/settings.json; `resolvedEnv`
// is env.ANTHROPIC_MODEL, which wins at runtime. When they disagree, the tooltip
// shows both so the displayed string is honest.
export const modelFull = signal<{ configured?: string; resolvedEnv?: string }>({});

on('sessionId', (msg) => {
  sessionId.value = msg.data;
});

on('setProcessing', (msg) => {
  processing.value = !!msg.data?.isProcessing;
});

on('modelSwitched' as any, (msg: any) => {
  if (msg.data?.model || msg.model) {
    resolvedModel.value = msg.data?.model || msg.model;
  }
});

on('modelSwitching' as any, (msg: any) => {
  if (msg.data?.model || msg.model) {
    resolvedModel.value = msg.data?.model || msg.model;
  }
});

on('modelSelected' as any, (msg: any) => {
  if (msg.data?.model || msg.model) {
    resolvedModel.value = msg.data?.model || msg.model;
  }
});

on('modelResolved' as any, (msg: any) => {
  if (msg.data?.model || msg.model) {
    resolvedModel.value = msg.data?.model || msg.model;
  }
});

on('modelFull', (msg) => {
  modelFull.value = msg.data || {};
});

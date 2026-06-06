import { signal } from '@preact/signals';
import { on } from '../vscode';

export interface TokenState {
  totalInput: number;
  totalOutput: number;
  requestCount: number;
  totalCost: number;
  currentInput: number;
  currentOutput: number;
  cacheCreation: number;
  cacheRead: number;
}

export const tokenState = signal<TokenState>({
  totalInput: 0,
  totalOutput: 0,
  requestCount: 0,
  totalCost: 0,
  currentInput: 0,
  currentOutput: 0,
  cacheCreation: 0,
  cacheRead: 0,
});

// Authoritative context-window occupancy from the CLI's get_context_usage
// (the same data /context shows). Separate signal from tokenState: different
// cadence (post-turn poll, not per-stream) and source. null until the first
// reading arrives, so the status bar can hide the chip entirely until then.
export interface ContextUsage {
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  autoCompactThreshold: number;
  isAutoCompactEnabled: boolean;
  categories: Array<{ name: string; tokens: number }>;
}

export const contextUsage = signal<ContextUsage | null>(null);

on('contextUsage' as any, (msg: any) => {
  contextUsage.value = msg.data as ContextUsage;
});

on('updateTokens' as any, (msg: any) => {
  tokenState.value = {
    ...tokenState.value,
    totalInput: msg.data.totalTokensInput || 0,
    totalOutput: msg.data.totalTokensOutput || 0,
    currentInput: msg.data.currentInputTokens || 0,
    currentOutput: msg.data.currentOutputTokens || 0,
    cacheCreation: msg.data.cacheCreationTokens || 0,
    cacheRead: msg.data.cacheReadTokens || 0,
  };
});

on('updateTotals' as any, (msg: any) => {
  tokenState.value = {
    ...tokenState.value,
    totalInput: msg.data.totalTokensInput || 0,
    totalOutput: msg.data.totalTokensOutput || 0,
    requestCount: msg.data.requestCount || 0,
    totalCost: msg.data.totalCost || 0,
  };
});

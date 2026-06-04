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

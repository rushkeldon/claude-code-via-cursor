import { signal } from '@preact/signals';
import { on } from '../vscode';

export interface QueuedItem {
  id: string;
  preview: string;
  hasImages: boolean;
}

// The current queued-prompt items, mirrored from the extension's queuedTurns.
// Fed by the `queueState` listener (registered at module level so it activates
// on import). Empty array ⇒ the peeking card is hidden (covers Skull-clears).
export const queuedItems = signal<QueuedItem[]>([]);

on('queueState' as any, (msg: any) => {
  const items = msg?.data?.items;
  queuedItems.value = Array.isArray(items) ? items : [];
});

// A fresh webview / new session starts with no queue until the extension
// re-emits (it does so on webviewReady).
on('ready', () => {
  queuedItems.value = [];
});

on('newSession' as any, () => {
  queuedItems.value = [];
});

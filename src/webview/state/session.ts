import { signal } from '@preact/signals';
import { on } from '../vscode';

export const sessionId = signal<string | null>(null);
export const processing = signal(false);
// True after a Skull (hard kill): the session is parked to History and the next
// user message will lazily respawn with --resume. Cleared once a turn starts.
export const sessionParked = signal(false);

on('sessionId', (msg) => {
  sessionId.value = msg.data;
});

on('setProcessing', (msg) => {
  processing.value = !!msg.data?.isProcessing;
  // A turn starting means we've recycled past any parked state.
  if (msg.data?.isProcessing) sessionParked.value = false;
});

on('sessionParked' as any, () => {
  sessionParked.value = true;
});

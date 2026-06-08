import { signal } from '@preact/signals';
import { on } from '../vscode';

export const sessionId = signal<string | null>(null);
export const processing = signal(false);
// True after a Skull (hard kill): the session is parked to History and the next
// user message will lazily respawn with --resume. Cleared once a turn starts.
export const sessionParked = signal(false);
// True after a recoverable provider API error: the composer's primary button
// becomes "Respawn". Not offered for bad-request (resending would just fail).
// Cleared once a turn starts (the apiError card itself does the recovery post).
export const respawnAvailable = signal(false);

on('sessionId', (msg) => {
  sessionId.value = msg.data;
});

on('apiError' as any, (msg: any) => {
  respawnAvailable.value = msg.data?.category !== 'bad-request';
});

on('setProcessing', (msg) => {
  processing.value = !!msg.data?.isProcessing;
  // A turn starting means we've recycled past any parked / error state.
  if (msg.data?.isProcessing) {
    sessionParked.value = false;
    respawnAvailable.value = false;
  }
});

on('sessionParked' as any, () => {
  sessionParked.value = true;
});

import { signal } from '@preact/signals';
import { on } from '../vscode';

export const currentProfile = signal<string | null>(null);
export const profileHealthy = signal(true);

on('identityProfile', (msg) => {
  currentProfile.value = msg.data.profile;
  profileHealthy.value = msg.data.healthy;
});

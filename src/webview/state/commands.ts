import { signal } from '@preact/signals';
import { on } from '../vscode';

export interface CommandInfo {
  name: string;
  description: string;
  type: 'builtin' | 'skill';
  // CC's own param-usage hint (e.g. "[model]") + aliases, from the handshake.
  argumentHint?: string;
  aliases?: string[];
}

export const commandList = signal<CommandInfo[]>([]);

on('commandList' as any, (msg: any) => {
  commandList.value = msg.data || [];
});

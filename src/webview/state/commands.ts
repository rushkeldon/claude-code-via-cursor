import { signal } from '@preact/signals';
import { on } from '../vscode';

export interface CommandInfo {
  name: string;
  description: string;
  type: 'builtin' | 'skill';
}

export const commandList = signal<CommandInfo[]>([]);

on('commandList' as any, (msg: any) => {
  commandList.value = msg.data || [];
});

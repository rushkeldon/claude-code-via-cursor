import { signal } from '@preact/signals';
import { Modal } from '../Modal/Modal';
import { on, post } from '../../vscode';

export const slashCommandsVisible = signal(false);

on('showSlashCommands', () => { slashCommandsVisible.value = true; });

const COMMANDS = [
  { name: 'compact', icon: '📦', description: 'Compact conversation to save context' },
  { name: 'clear', icon: '🗑️', description: 'Clear conversation history' },
  { name: 'help', icon: '❓', description: 'Get usage help' },
  { name: 'cost', icon: '💰', description: 'Show token usage statistics' },
  { name: 'doctor', icon: '🩺', description: 'Check Claude Code installation health' },
  { name: 'model', icon: '🤖', description: 'Select or change the AI model' },
  { name: 'permissions', icon: '🔒', description: 'View or update permissions' },
  { name: 'memory', icon: '🧠', description: 'Edit CLAUDE.md memory files' },
  { name: 'review', icon: '👀', description: 'Request code review' },
  { name: 'init', icon: '🚀', description: 'Initialize project with CLAUDE.md' },
  { name: 'login', icon: '🔑', description: 'Switch Anthropic accounts' },
  { name: 'status', icon: '📊', description: 'Show version, model, and connectivity' },
];

function executeCommand(name: string) {
  post({ type: 'executeSlashCommand', command: name } as any);
  slashCommandsVisible.value = false;
}

export function SlashCommandsModal() {
  return (
    <Modal
      title="Slash Commands"
      visible={slashCommandsVisible.value}
      onClose={() => { slashCommandsVisible.value = false; }}
    >
      <div style="display: flex; flex-direction: column; gap: 2px;">
        {COMMANDS.map((cmd) => (
          <button
            key={cmd.name}
            type="button"
            onClick={() => executeCommand(cmd.name)}
            style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: none; border: none; color: var(--vscode-foreground); font-size: 13px; cursor: pointer; border-radius: 4px; text-align: left; width: 100%;"
            onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.1))'; }}
            onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
          >
            <span style="font-size: 16px; flex-shrink: 0;">{cmd.icon}</span>
            <div style="display: flex; flex-direction: column; gap: 1px;">
              <span style="font-weight: 500; font-size: 12px;">/{cmd.name}</span>
              <span style="font-size: 11px; color: var(--vscode-descriptionForeground);">{cmd.description}</span>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

import { signal } from '@preact/signals';
import { Modal } from '../Modal/Modal';
import { on, post } from '../../vscode';

export const mcpModalVisible = signal(false);

on('showMCPModal', () => { mcpModalVisible.value = true; });

export function MCPServersList() {
  return (
    <Modal
      title="MCP Servers"
      visible={mcpModalVisible.value}
      onClose={() => { mcpModalVisible.value = false; }}
    >
      <p style="color: var(--vscode-descriptionForeground); font-size: 12px;">
        MCP servers will be loaded from the extension.
      </p>
    </Modal>
  );
}

import { signal } from '@preact/signals';
import { Modal } from '../Modal/Modal';
import { on, post } from '../../vscode';

export const pluginsModalVisible = signal(false);

on('showPluginsModal', () => { pluginsModalVisible.value = true; });

export function PluginsMarketplace() {
  return (
    <Modal
      title="Plugins"
      visible={pluginsModalVisible.value}
      onClose={() => { pluginsModalVisible.value = false; }}
    >
      <p style="color: var(--vscode-descriptionForeground); font-size: 12px;">
        Plugins will be loaded from the extension.
      </p>
    </Modal>
  );
}

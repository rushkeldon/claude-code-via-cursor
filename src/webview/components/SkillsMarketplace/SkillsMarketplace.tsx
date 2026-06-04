import { signal } from '@preact/signals';
import { Modal } from '../Modal/Modal';
import { on, post } from '../../vscode';

export const skillsModalVisible = signal(false);

on('showSkillsModal', () => { skillsModalVisible.value = true; });

export function SkillsMarketplace() {
  return (
    <Modal
      title="Skills"
      visible={skillsModalVisible.value}
      onClose={() => { skillsModalVisible.value = false; }}
    >
      <p style="color: var(--vscode-descriptionForeground); font-size: 12px;">
        Skills will be loaded from the extension.
      </p>
    </Modal>
  );
}

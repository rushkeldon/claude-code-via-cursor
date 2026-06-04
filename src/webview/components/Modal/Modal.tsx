import './Modal.less';
import { ComponentChildren } from 'preact';

interface ModalProps {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: ComponentChildren;
}

export function Modal({ title, visible, onClose, children }: ModalProps) {
  if (!visible) return null;

  return (
    <div class="tools-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="tools-modal-content">
        <div class="tools-modal-header">
          <span>{title}</span>
          <button class="tools-close-btn" type="button" onClick={onClose}>✕</button>
        </div>
        <div class="tools-modal-body">
          {children}
        </div>
      </div>
    </div>
  );
}

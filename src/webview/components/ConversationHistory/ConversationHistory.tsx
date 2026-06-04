import './ConversationHistory.less';
import { signal } from '@preact/signals';
import { on, post } from '../../vscode';
import { Modal } from '../Modal/Modal';

export const historyVisible = signal(false);

interface ConversationItem {
  filename: string;
  sessionId: string;
  startTime: string;
  endTime: string;
  messageCount: number;
  firstUserMessage: string;
  lastUserMessage: string;
}

const conversations = signal<ConversationItem[]>([]);

on('conversationList' as any, (msg: any) => {
  conversations.value = msg.data || [];
});

function formatTime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return d.toLocaleDateString([], { weekday: 'short' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function ConversationHistory() {
  function loadConversation(filename: string) {
    post({ type: 'loadConversation', filename } as any);
    historyVisible.value = false;
  }

  function deleteConversation(e: Event, filename: string) {
    e.stopPropagation();
    post({ type: 'deleteConversation', filename } as any);
    conversations.value = conversations.value.filter(c => c.filename !== filename);
  }

  return (
    <Modal
      title="Conversation History"
      visible={historyVisible.value}
      onClose={() => { historyVisible.value = false; }}
    >
      <div class="conversation-list">
        {conversations.value.length === 0 ? (
          <p class="conversation-empty">No saved conversations.</p>
        ) : (
          conversations.value.map((conv) => (
            <div
              class="conversation-item"
              key={conv.filename}
              onClick={() => loadConversation(conv.filename)}
            >
              <div class="conversation-item-content">
                <span class="conversation-item-label">{conv.firstUserMessage || 'Untitled'}</span>
                <span class="conversation-item-meta">
                  {conv.messageCount} messages • {formatTime(conv.startTime)}
                </span>
              </div>
              <button
                class="conversation-item-delete"
                type="button"
                title="Delete conversation"
                onClick={(e) => deleteConversation(e, conv.filename)}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

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
  title?: string;
}

const conversations = signal<ConversationItem[]>([]);
// Session ids currently locked by another live window (badge + Fork, no resume).
const lockedSessionIds = signal<string[]>([]);

on('conversationList' as any, (msg: any) => {
  conversations.value = msg.data || [];
});

on('lockedSessions' as any, (msg: any) => {
  lockedSessionIds.value = Array.isArray(msg.data?.sessionIds) ? msg.data.sessionIds : [];
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
  function loadConversation(filename: string, locked: boolean) {
    if (locked) return; // locked rows aren't directly resumable — use Fork
    post({ type: 'loadConversation', filename } as any);
    historyVisible.value = false;
  }

  function forkConversation(e: Event, sessionId: string) {
    e.stopPropagation();
    // Fork the locked session into a new one this window owns (terminal).
    post({ type: 'forkSession', sessionId } as any);
    historyVisible.value = false;
  }

  function deleteConversation(e: Event, filename: string) {
    e.stopPropagation();
    post({ type: 'deleteConversation', filename } as any);
    conversations.value = conversations.value.filter(c => c.filename !== filename);
  }

  const locked = new Set(lockedSessionIds.value);

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
          conversations.value.map((conv) => {
            const isLocked = locked.has(conv.sessionId);
            return (
              <div
                class={`conversation-item${isLocked ? ' locked' : ''}`}
                key={conv.filename}
                onClick={() => loadConversation(conv.filename, isLocked)}
                title={isLocked ? 'Active in another window — fork to work on a copy here' : undefined}
              >
                <div class="conversation-item-content">
                  <span class="conversation-item-label">
                    {isLocked && <span class="conversation-item-lock" title="Active in another window">🔒</span>}
                    {conv.title || conv.firstUserMessage || 'Untitled'}
                  </span>
                  <span class="conversation-item-meta">
                    {conv.messageCount} messages • {formatTime(conv.startTime)}
                    {isLocked && ' • active elsewhere'}
                  </span>
                </div>
                {isLocked ? (
                  <button
                    class="conversation-item-fork"
                    type="button"
                    title="Fork this session into a new terminal session"
                    onClick={(e) => forkConversation(e, conv.sessionId)}
                  >
                    Fork
                  </button>
                ) : (
                  <button
                    class="conversation-item-delete"
                    type="button"
                    title="Delete conversation"
                    onClick={(e) => deleteConversation(e, conv.filename)}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

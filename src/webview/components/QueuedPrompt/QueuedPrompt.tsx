import './QueuedPrompt.less';
import { post } from '../../vscode';
import { processing } from '../../state/session';
import { queuedItems } from '../../state/queue';

// The peeking "queued prompt" card. Renders ONLY while a turn is in flight
// (processing === true) AND there is at least one queued item. Shows the head
// item as a user-bubble-styled card with a `queued` badge, plus a `+N` count
// badge when more than one item is queued. Positioned absolute/overlay so it
// pokes up over the chat history's bottom edge without growing the prompt pane.
//
// Three affordances (resolved with product direction):
//   ⬆ send now  — interrupt the live turn and run this item now
//   ⬇ demote    — pull the item's text back into the prompt input for editing
//   ✕ delete    — drop the item from the queue
export function QueuedPrompt() {
  const items = queuedItems.value;
  const isProcessing = processing.value;

  // Only peek while a turn is actually running and something is queued.
  if (!isProcessing || items.length === 0) return null;

  const head = items[0];
  const extra = items.length - 1;

  function sendNow() {
    post({ type: 'sendNow' } as any);
  }

  function demote() {
    post({ type: 'demoteQueued', id: head.id } as any);
  }

  function cancel() {
    post({ type: 'cancelQueued', id: head.id } as any);
  }

  return (
    <div class="queued-prompt">
      <span class="queued-prompt-badge">queued</span>
      {extra > 0 && (
        <span class="queued-prompt-count" title={`${items.length} prompts queued`}>+{extra}</span>
      )}
      {head.hasImages && (
        <span class="queued-prompt-attach" title="Has an image attachment" aria-label="image attachment">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <circle cx="5.5" cy="6" r="1.2" />
            <path d="M2 12l4-3.5 3 2.5 2.5-2 2.5 3" />
          </svg>
        </span>
      )}
      <span class="queued-prompt-text" title={head.preview}>{head.preview || 'Attachment(s) only'}</span>
      <div class="queued-prompt-actions">
        <button class="queued-prompt-btn" type="button" onClick={sendNow} title="Send now — interrupt the current turn and run this next">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="6 11 12 5 18 11" />
          </svg>
        </button>
        <button class="queued-prompt-btn" type="button" onClick={demote} title="Pull back into the prompt box to edit">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="6 13 12 19 18 13" />
          </svg>
        </button>
        <button class="queued-prompt-btn queued-prompt-btn--danger" type="button" onClick={cancel} title="Cancel this queued prompt">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

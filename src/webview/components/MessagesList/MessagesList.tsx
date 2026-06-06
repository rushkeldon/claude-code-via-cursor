import './MessagesList.less';
import { useRef, useLayoutEffect } from 'preact/hooks';
import { messages, ChatMsg } from '../../state/messages';
import { UserMessage } from '../UserMessage/UserMessage';
import { ClaudeMessage } from '../ClaudeMessage/ClaudeMessage';
import { SystemMessage } from '../SystemMessage/SystemMessage';
import { ErrorMessage } from '../ErrorMessage/ErrorMessage';
import { NoticeCard } from '../NoticeCard/NoticeCard';
import { ToolUseMessage } from '../ToolMessage/ToolMessage';
import { ToolResultMessage } from '../ToolResultMessage/ToolResultMessage';
import { ThinkingPill } from '../ThinkingPill/ThinkingPill';
import { ActiveThinkingPane, thinkingText, thinkingActive } from '../ThinkingPane/ThinkingPane';
import { PendingAskUserQuestions, InlineQuestionCard, pendingQuestions } from '../AskUserQuestion/AskUserQuestion';
import { PendingPermissions, InlinePermissionCard, pendingPermissions } from '../PermissionRequest/PermissionRequest';

function renderMessage(msg: ChatMsg & { elapsedLabel?: string }, index: number) {
  switch (msg.role) {
    case 'user':
      return <UserMessage key={index} content={msg.content} images={msg.images} />;
    case 'assistant':
      return <ClaudeMessage key={index} content={msg.content} />;
    case 'system':
      return <SystemMessage key={index} content={msg.content} />;
    case 'error':
      return <ErrorMessage key={index} content={msg.content} />;
    case 'thinking' as any:
      return <ThinkingPill key={index} content={msg.content} elapsedLabel={msg.elapsedLabel || '?'} noThoughts={msg.noThoughts} />;
    case 'question' as any:
      return msg.questionData ? <InlineQuestionCard key={index} questionData={msg.questionData} /> : null;
    case 'permission' as any:
      return msg.permissionData ? <InlinePermissionCard key={index} permissionData={msg.permissionData} /> : null;
    case 'notice' as any:
      return (
        <NoticeCard
          key={index}
          variant={msg.noticeVariant || 'warning'}
          title={msg.noticeTitle || 'Notice'}
        >
          {msg.content && <p>{msg.content}</p>}
        </NoticeCard>
      );
    case 'tool' as any:
      // AskUserQuestion is shown as its own interactive Q&A card — don't also
      // render the generic tool card for it (it's redundant noise above the panel).
      if (msg.toolName === 'AskUserQuestion') return null;
      return <ToolUseMessage key={index} toolName={msg.toolName || 'Tool'} content={msg.content} rawInput={msg.rawInput} />;
    case 'tool-result' as any:
      return <ToolResultMessage key={index} content={msg.content} />;
    default:
      return null;
  }
}

// Within this many px of the bottom counts as "stuck to the bottom" — small
// scroll jitter or sub-pixel rounding shouldn't read as "the user scrolled up".
const STICKY_THRESHOLD_PX = 50;

export function MessagesList() {
  const containerRef = useRef<HTMLDivElement>(null);
  // The scroll position is sticky by default: we keep following new content
  // until the user scrolls up, and resume following once they return to the
  // bottom. This ref is the single source of truth, updated only by the user's
  // own scrolls (handleScroll) — our programmatic scrolls never flip it.
  const stickToBottom = useRef(true);
  // Count of distinct entries last render. A NEW entry (message, pending Q&A, or
  // permission card) is a discrete arrival we may want to top-align; growth of
  // existing content (streaming text, thinking) just keeps the bottom pinned.
  const prevEntryCount = useRef(0);
  // True while we're mid-programmatic-scroll, so the scroll event it fires
  // doesn't get mistaken for the user manually scrolling.
  const selfScrolling = useRef(false);

  function scrollToBottom() {
    const el = containerRef.current;
    if (!el) return;
    selfScrolling.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' as ScrollBehavior });
    // Clear on the next frame — after the scroll event has fired and settled.
    requestAnimationFrame(() => { selfScrolling.current = false; });
  }

  // Top-align the last child (the newest entry) so a tall card/reply opens with
  // its top at the top of the viewport. Falls back to bottom-pin if there's no
  // child to align.
  function scrollNewestToTop() {
    const el = containerRef.current;
    if (!el) return;
    const last = el.lastElementChild as HTMLElement | null;
    if (!last) { scrollToBottom(); return; }
    selfScrolling.current = true;
    last.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
    requestAnimationFrame(() => { selfScrolling.current = false; });
  }

  function handleScroll() {
    if (selfScrolling.current) return;
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD_PX;
    stickToBottom.current = atBottom;
  }

  // Reading these signals here subscribes the component so it re-renders (and the
  // layout effect re-runs) on every change: streaming text, thinking growth, and
  // — crucially for the scroll-into-view fix — a new pending Q&A or permission
  // card appearing (those render outside the `messages` array, so without these
  // reads a new card would never trigger a scroll).
  const _thinking = thinkingText.value;
  const _active = thinkingActive.value;
  const entryCount =
    messages.value.length + pendingQuestions.value.length + pendingPermissions.value.length;

  // useLayoutEffect: scroll before paint so the user never sees the pre-scroll
  // frame. Runs after every render (no dep array) so streaming growth keeps the
  // bottom pinned, while a new entry triggers the top-align path.
  useLayoutEffect(() => {
    const hasNewEntry = entryCount > prevEntryCount.current;
    prevEntryCount.current = entryCount;
    if (!stickToBottom.current) return;

    if (hasNewEntry) {
      const el = containerRef.current;
      const last = el?.lastElementChild as HTMLElement | null;
      // Top-align only when the new entry is taller than the viewport — otherwise
      // top-aligning would leave dead space below a short message. Short entries
      // just bottom-pin (standard chat behavior).
      if (el && last && last.offsetHeight > el.clientHeight) {
        scrollNewestToTop();
        return;
      }
    }
    scrollToBottom();
  });

  return (
    <div class="messages" ref={containerRef} onScroll={handleScroll}>
      {messages.value.map((msg, i) => renderMessage(msg as any, i))}
      <PendingPermissions />
      <PendingAskUserQuestions />
      <ActiveThinkingPane />
    </div>
  );
}

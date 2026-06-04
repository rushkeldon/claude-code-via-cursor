import './MessagesList.less';
import { useRef, useEffect } from 'preact/hooks';
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
import { PendingAskUserQuestions, InlineQuestionCard } from '../AskUserQuestion/AskUserQuestion';

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
      return <ThinkingPill key={index} content={msg.content} elapsedLabel={msg.elapsedLabel || '?'} />;
    case 'question' as any:
      return msg.questionData ? <InlineQuestionCard key={index} questionData={msg.questionData} /> : null;
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
      return <ToolUseMessage key={index} toolName={msg.toolName || 'Tool'} content={msg.content} rawInput={msg.rawInput} />;
    case 'tool-result' as any:
      return <ToolResultMessage key={index} content={msg.content} />;
    default:
      return null;
  }
}

export function MessagesList() {
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  function scrollToBottom() {
    const el = containerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'instant' as ScrollBehavior });
    }
  }

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    userScrolledUp.current = !atBottom;
  }

  // Scroll to bottom on mount and when new messages arrive (only if user hasn't scrolled up)
  useEffect(() => {
    if (!userScrolledUp.current) {
      scrollToBottom();
    }
  }, [messages.value.length]);

  // Scroll to bottom when messages change or thinking content grows
  // Reading thinkingText.value and thinkingActive.value here makes this
  // component re-render when they change, triggering the scroll check.
  const _thinking = thinkingText.value;
  const _active = thinkingActive.value;

  useEffect(() => {
    if (!userScrolledUp.current) {
      scrollToBottom();
    }
  });

  return (
    <div class="messages" ref={containerRef} onScroll={handleScroll}>
      {messages.value.map((msg, i) => renderMessage(msg as any, i))}
      <PendingAskUserQuestions />
      <ActiveThinkingPane />
    </div>
  );
}

import { ChatMessage } from '../ChatMessage/ChatMessage';

interface SystemMessageProps {
  content: string;
}

export function SystemMessage({ content }: SystemMessageProps) {
  return (
    <ChatMessage type="system" showHeader={false}>
      <p>{content}</p>
    </ChatMessage>
  );
}

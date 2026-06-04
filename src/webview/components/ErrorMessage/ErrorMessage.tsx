import { ChatMessage } from '../ChatMessage/ChatMessage';

interface ErrorMessageProps {
  content: string;
}

export function ErrorMessage({ content }: ErrorMessageProps) {
  return (
    <ChatMessage type="error" icon="⚠️" label="Error">
      <p>{content}</p>
    </ChatMessage>
  );
}

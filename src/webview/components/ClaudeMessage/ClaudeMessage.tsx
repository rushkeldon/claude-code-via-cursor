import { ChatMessage } from "../ChatMessage/ChatMessage";
import { parseSimpleMarkdown } from "../../markdown";

interface ClaudeMessageProps {
  content: string;
}

export function ClaudeMessage({ content }: ClaudeMessageProps) {
  const html = parseSimpleMarkdown(content);
  return (
    <ChatMessage type="claude" icon="✳" label="Claude">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </ChatMessage>
  );
}

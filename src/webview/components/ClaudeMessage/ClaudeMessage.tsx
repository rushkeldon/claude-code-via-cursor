import { ChatMessage } from "../ChatMessage/ChatMessage";
import { segmentMarkdown } from "../../markdown";
import { CodeBlock } from "../CodeBlock/CodeBlock";

interface ClaudeMessageProps {
  content: string;
}

export function ClaudeMessage({ content }: ClaudeMessageProps) {
  // Split into prose runs (injected HTML) and fenced code blocks (real
  // CodeBlock components, each with its own copy button).
  const segments = segmentMarkdown(content);
  return (
    <ChatMessage type="claude" icon="✳" label="Claude" copyText={content}>
      {segments.map((seg, i) =>
        seg.type === "code" ? (
          <CodeBlock key={i} code={seg.code} lang={seg.lang} />
        ) : (
          <div key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />
        ),
      )}
    </ChatMessage>
  );
}

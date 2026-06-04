import { ChatMessage } from "../ChatMessage/ChatMessage";
import { parseSimpleMarkdown } from "../../markdown";
import { currentProfile } from "../../state/profile";
import { post } from "../../vscode";
import { useState } from "preact/hooks";

interface UserMessageProps {
  content: string;
  images?: Array<{ filePath: string; previewUri: string }>;
}

export function UserMessage({ content, images }: UserMessageProps) {
  const [copied, setCopied] = useState(false);
  const profile = currentProfile.value;
  const label = profile ? `You (${profile})` : "You";

  function openImage(filePath: string) {
    post({ type: "openImageFile", filePath } as any);
  }

  function handleCopy(e: Event) {
    e.stopPropagation();
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      post({ type: 'copyToClipboard', text: content } as any);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <ChatMessage type="user" icon="" label={label}>
      <button
        class="user-copy-btn"
        type="button"
        title="Copy message"
        onClick={handleCopy}
      >
        {copied
          ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
          : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>}
      </button>
      <div dangerouslySetInnerHTML={{ __html: parseSimpleMarkdown(content) }} />
      {images && images.length > 0 && (
        <div class="message-images">
          {images.map((img) => (
            <div class="message-image-wrap" key={img.filePath}>
              <img
                src={img.previewUri}
                alt="attached"
                class="message-image-thumbnail"
                onClick={() => openImage(img.filePath)}
              />
            </div>
          ))}
        </div>
      )}
    </ChatMessage>
  );
}

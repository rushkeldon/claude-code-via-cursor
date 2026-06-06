import { ChatMessage } from "../ChatMessage/ChatMessage";
import { parseSimpleMarkdown } from "../../markdown";
import { currentProfile } from "../../state/profile";
import { CopyButton } from "../CopyButton/CopyButton";
import { post } from "../../vscode";

interface UserMessageProps {
  content: string;
  images?: Array<{ filePath: string; previewUri: string }>;
}

export function UserMessage({ content, images }: UserMessageProps) {
  const profile = currentProfile.value;
  const label = profile ? `You (${profile})` : "You";

  function openImage(filePath: string) {
    post({ type: "openImageFile", filePath } as any);
  }

  return (
    <ChatMessage type="user" icon="" label={label} copyText={content}>
      <CopyButton text={content} title="Copy message" class="user-copy-btn" />
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

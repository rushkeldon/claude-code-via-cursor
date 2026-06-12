import { ChatMessage } from "../ChatMessage/ChatMessage";
import { parseSimpleMarkdown } from "../../markdown";
import { post } from "../../vscode";

interface UserMessageProps {
  content: string;
  images?: Array<{ filePath: string; previewUri: string }>;
}

export function UserMessage({ content, images }: UserMessageProps) {
  const label = "You";

  function openImage(filePath: string) {
    post({ type: "openImageFile", filePath } as any);
  }

  // Header (icon + label) so the message collapses via the shared header
  // chevron. NOTE: placeholder "❯" icon + standard header for now — the plan is
  // to thread a slimmer/headerless-but-collapsible treatment later. The header
  // supplies the copy button, so the old inline user-copy-btn is removed.
  return (
    <ChatMessage type="user" icon="❯" label={label} copyText={content}>
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

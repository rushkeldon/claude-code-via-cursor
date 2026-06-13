import "../ToolMessage/ToolMessage.less";
import { ChatMessage } from "../ChatMessage/ChatMessage";

// Parent-window-only notice that this session was forked into a terminal. NOT a
// model turn — emitted by the extension host when a fork launches. Renders as a
// bodyless inline tool-header (reusing ToolMessage's styling): "FORKED" on the
// left (.tool-info, with the category accent), and the message right-aligned in a
// .tool-file-link--inline-shaped span (rtl left-ellipsis truncation). The message
// is prefixed with a U+200E Left-to-Right Mark so `direction: rtl` doesn't reorder
// trailing punctuation — same guard the file-path links use.
export function ForkedCard({ message }: { message: string }) {
  return (
    <ChatMessage type="tool" showHeader={false} accent="generic" collapsible={false}>
      <div class="tool-header tool-header--inline">
        <div class="tool-info">FORKED</div>
        <span class="forked-card-message" title={message}>
          {"‎" + message}
        </span>
      </div>
    </ChatMessage>
  );
}

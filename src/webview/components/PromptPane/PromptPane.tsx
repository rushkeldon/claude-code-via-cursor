import "./PromptPane.less";
import { signal } from "@preact/signals";
import { VNode } from "preact";
import { useState, useRef, useEffect } from "preact/hooks";
import { post, on } from "../../vscode";
import { processing, respawnAvailable } from "../../state/session";
import { commandList } from "../../state/commands";
import { modeItems, activeMode, type ModeItem } from "../../state/settings";
import { ModelSelector } from "../ModelSelector/ModelSelector";
import { EffortPicker } from "../EffortPicker/EffortPicker";
import { ThoughtsToggle } from "../ThoughtsToggle/ThoughtsToggle";
import { DroppedFile } from "../DroppedFile/DroppedFile";
import { CommandAutocomplete } from "../CommandAutocomplete/CommandAutocomplete";
import { slashCommandsVisible } from "../SlashCommands/SlashCommands";
import { QueuedPrompt } from "../QueuedPrompt/QueuedPrompt";
import { pendingQuestions } from "../AskUserQuestion/AskUserQuestion";

export interface DroppedFileData {
  filePath: string;
  contents: string;
  language: string;
}

const planMode = signal(false);
const terminalMode = signal(false);

// The mode picker mirrors Cursor's: a pill showing the *real* active mode (read
// by the host from the modes skill's active_modes.md → activeMode signal) that
// opens a menu of configured items (modeItems signal, from ccvc.modes.items).
// Clicking an item SENDS its command explicitly (a visible turn); the pill does
// NOT change optimistically — it updates only when the host reports the file
// actually changed. Icons stay code-side, keyed by id, with a generic fallback
// for user-added ids. Glyphicons (licensed), inlined as currentColor SVG so they
// theme via --vscode-*.
const MODE_ICONS: Record<string, VNode> = {
  agent: (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor">
      <path d="M7.3 18.015q0-.087.022-.174l1.618-6.384H4.56a.73.73 0 0 1-.582-1.166l6.543-8.744a.74.74 0 0 1 .583-.29h.182a.73.73 0 0 1 .73.728q-.002.074-.016.16l-1.282 5.669h4.722a.73.73 0 0 1 .728.729.7.7 0 0 1-.153.444L8.773 18.46a.74.74 0 0 1-.576.284h-.168a.73.73 0 0 1-.729-.729Z" />
    </svg>
  ),
  plan: (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor">
      <path d="M.657 15.249V4.751a3.16 3.16 0 0 1 3.15-3.15h10.497c.315 0 .609.064.892.148L12.845 3.7H3.806c-.577 0-1.05.472-1.05 1.05v10.498c0 .578.473 1.05 1.05 1.05h10.498c.578 0 1.05-.472 1.05-1.05v-3.821l2.1-2.184v6.005a3.16 3.16 0 0 1-3.15 3.15H3.806a3.16 3.16 0 0 1-3.15-3.15Zm9.112-1.522c-.284 0-.556-.116-.766-.336L5.16 9.286a.6.6 0 0 1-.136-.368c0-.115.042-.23.116-.325l.818-1.018a.53.53 0 0 1 .41-.2c.094 0 .2.032.283.095l2.75 1.826 8.032-6.687a.54.54 0 0 1 .336-.126.53.53 0 0 1 .377.158l1.04 1.05a.5.5 0 0 1 .157.367.56.56 0 0 1-.147.367l-8.671 8.976c-.21.22-.483.326-.756.326" />
    </svg>
  ),
};
// Generic fallback icon for user-added mode ids without a built-in glyph.
const MODE_ICON_FALLBACK: VNode = (
  <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor">
    <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.6" />
  </svg>
);
function iconForMode(id: string): VNode {
  return MODE_ICONS[id] ?? MODE_ICON_FALLBACK;
}
const terminalInput = signal("");
const images = signal<Array<{ filePath: string; previewUri: string }>>([]);
const droppedFiles = signal<DroppedFileData[]>([]);

// A queued prompt the user demoted (⬇) back into the input. Carries the text +
// flags so the textarea + plan/thinking toggles can repopulate. Consumed (and
// cleared) by an effect in PromptPane once applied to the live textarea.
const pendingDemote = signal<{ message: string; planMode: boolean } | null>(
  null,
);

// Transient hint shown under the input when Send is blocked because a question
// is pending (Phase C). Cleared on the next keystroke or when no question pends.
const sendBlockedHint = signal(false);

on("imageAttached" as any, (msg: any) => {
  images.value = [
    ...images.value,
    { filePath: msg.filePath, previewUri: msg.previewUri || msg.thumbnailUri },
  ];
});

on("queuedDemoted" as any, (msg: any) => {
  const data = msg.data || {};
  // Restore images immediately (their own signal); the text + flags are applied
  // to the ref-based textarea by the effect below.
  if (Array.isArray(data.images) && data.images.length > 0) {
    images.value = [
      ...images.value,
      ...data.images.map((img: any) => ({
        filePath: img.filePath,
        previewUri: img.previewUri || "",
      })),
    ];
  }
  pendingDemote.value = {
    message: data.message || "",
    planMode: !!data.planMode,
  };
});

on("fileDropped" as any, (msg: any) => {
  const data = msg.data;
  droppedFiles.value = [
    ...droppedFiles.value,
    {
      filePath: data.filePath,
      contents: data.contents,
      language: data.language,
    },
  ];
});

export function PromptPane() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isProcessing = processing.value;
  const canRespawn = respawnAvailable.value;

  // Mode picker open/close, mirroring ModelSelector's outside-click handling.
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!modeMenuOpen) return;
    const close = (e: Event) => {
      if (modeRootRef.current && !modeRootRef.current.contains(e.target as Node))
        setModeMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("focusin", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("focusin", close);
    };
  }, [modeMenuOpen]);

  // Apply a demoted queued prompt to the (ref-based) textarea + flags. Reads the
  // signal so it re-runs whenever an item is pulled back via the card's ⬇.
  const demote = pendingDemote.value;
  useEffect(() => {
    if (!demote) return;
    const textarea = textareaRef.current;
    if (textarea) {
      // Prepend so we don't clobber anything the user already started typing.
      const existing = textarea.value;
      textarea.value = existing
        ? `${demote.message}\n${existing}`
        : demote.message;
      autoResize(textarea);
      textarea.focus();
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    }
    planMode.value = demote.planMode;
    pendingDemote.value = null;
  }, [demote]);

  // Once the pending question is answered/cleared, the block-with-hint no longer
  // applies — drop it so a stale "answer the question first" doesn't linger.
  const hasPendingQuestion = pendingQuestions.value.length > 0;
  useEffect(() => {
    if (!hasPendingQuestion && sendBlockedHint.value)
      sendBlockedHint.value = false;
  }, [hasPendingQuestion]);

  function sendMessage() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const userText = textarea.value.trim();
    if (
      !userText &&
      images.value.length === 0 &&
      droppedFiles.value.length === 0
    )
      return;

    // Phase C — block-with-hint: while a question/permission is pending the turn
    // can't end on its own, so a queued prompt behind it would be trapped. Don't
    // silently queue; hint the user to answer the question and point at its card.
    if (pendingQuestions.value.length > 0) {
      sendBlockedHint.value = true;
      const card =
        document.querySelector(".ask-user-question:not(.decided)") ||
        document.querySelector(".ask-user-question");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    let text = "";
    if (droppedFiles.value.length > 0) {
      for (const f of droppedFiles.value) {
        text += `File: ${f.filePath}\n\n\`\`\`${f.language}\n${f.contents}\n\`\`\`\n\n`;
      }
    }
    text += userText;

    post({
      type: "sendMessage",
      text,
      planMode: planMode.value,
      images: images.value.length > 0 ? images.value : undefined,
    });

    textarea.value = "";
    images.value = [];
    droppedFiles.value = [];
    autoResize(textarea);

    // If we were in pass-through (terminal/green) mode — e.g. the user typed a
    // /command then hit the Send button rather than Enter — clear that state too.
    // Without this the textarea empties but the green border + placeholder linger
    // because nothing resets terminalMode (handleInput only fires on real typing).
    if (terminalMode.value) {
      terminalMode.value = false;
      terminalInput.value = "";
    }
  }

  function stopRequest() {
    // Graceful stop: interrupt the turn, keep the process warm.
    post({ type: "stopRequest" } as any);
  }

  function skullRequest() {
    // Hard kill: terminate the process group + park to history.
    post({ type: "skull" } as any);
  }

  function respawnRequest() {
    // Recover from a provider API error: respawn fresh (re-reads auth) and
    // re-send the failed turn. Clears the local flag immediately for snappy UI;
    // setProcessing(true) from the resent turn keeps it cleared.
    respawnAvailable.value = false;
    post({ type: "respawn" } as any);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (terminalMode.value) {
      if (e.key === "Escape") {
        e.preventDefault();
        exitTerminalMode();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        executeTerminalCommand();
        return;
      }
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInput(e: Event) {
    const textarea = e.currentTarget as HTMLTextAreaElement;
    autoResize(textarea);
    // Any typing dismisses the "answer the question first" hint.
    if (sendBlockedHint.value) sendBlockedHint.value = false;

    if (terminalMode.value) {
      if (!textarea.value.startsWith("/")) {
        exitTerminalMode();
        return;
      }
      terminalInput.value = textarea.value;
    } else if (textarea.value === "/" && textarea.selectionStart === 1) {
      enterTerminalMode();
    }
  }

  function enterTerminalMode() {
    terminalMode.value = true;
    terminalInput.value = "/";
    post({ type: "fetchCommandList" } as any);
  }

  function exitTerminalMode() {
    terminalMode.value = false;
    terminalInput.value = "";
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.value = "";
      autoResize(textarea);
    }
  }

  function executeTerminalCommand() {
    const command = (
      terminalInput.value ||
      textareaRef.current?.value ||
      ""
    ).trim();
    if (!command) return;
    // Raw pass-through over the existing stream-json stdin channel — the same
    // path a normal message takes. No denylist: the CLI's headless initialize
    // list already excludes TTY-only commands, so anything the palette offered
    // is safe to send inline. The toolbar breakout (below) stays as a manual,
    // on-demand fork for anyone who deliberately wants a real terminal.
    post({
      type: "sendMessage",
      text: command,
      planMode: planMode.value,
    });
    exitTerminalMode();
  }

  function selectCommand(cmd: { name: string }) {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.value = `/${cmd.name} `;
      terminalInput.value = `/${cmd.name} `;
      textarea.focus();
    }
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  // Selecting a mode SENDS its configured command explicitly — a real, visible
  // turn over the normal sendMessage path. The pill is NOT updated here: it
  // reflects the real active mode reported by the host (activeMode signal) once
  // the modes skill actually writes active_modes.md. This removes the old
  // click-then-backspace desync entirely. Sending while a turn is in flight is
  // handled by the normal queueing in the send path.
  function selectMode(item: ModeItem) {
    setModeMenuOpen(false);
    const cmd = item.command?.trim();
    if (!cmd) return;
    post({
      type: "sendMessage",
      text: cmd,
      planMode: planMode.value,
    });
  }

  function selectImage() {
    post({ type: "selectImageFile" } as any);
  }

  function removeImage(index: number) {
    images.value = images.value.filter((_, i) => i !== index);
  }

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    function generateThumbnail(dataUrl: string): Promise<string> {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          // Generate at 500px wide for retina clarity when displayed at 250px
          const thumbWidth = 500;
          const targetScale = thumbWidth / img.width;
          const targetHeight = Math.round(img.height * targetScale);

          let currentCanvas = document.createElement("canvas");
          currentCanvas.width = img.width;
          currentCanvas.height = img.height;
          let ctx = currentCanvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0);

          let currentWidth = img.width;
          let currentHeight = img.height;

          while (currentWidth > thumbWidth * 1.5) {
            const nextWidth = Math.max(
              thumbWidth,
              Math.round(currentWidth * 0.5),
            );
            const nextHeight = Math.round(
              (nextWidth / currentWidth) * currentHeight,
            );
            const nextCanvas = document.createElement("canvas");
            nextCanvas.width = nextWidth;
            nextCanvas.height = nextHeight;
            const nextCtx = nextCanvas.getContext("2d")!;
            nextCtx.imageSmoothingEnabled = true;
            nextCtx.imageSmoothingQuality = "high";
            nextCtx.drawImage(currentCanvas, 0, 0, nextWidth, nextHeight);
            currentCanvas = nextCanvas;
            currentWidth = nextWidth;
            currentHeight = nextHeight;
          }

          const finalCanvas = document.createElement("canvas");
          finalCanvas.width = thumbWidth;
          finalCanvas.height = targetHeight;
          const finalCtx = finalCanvas.getContext("2d")!;
          finalCtx.imageSmoothingEnabled = true;
          finalCtx.imageSmoothingQuality = "high";
          finalCtx.drawImage(currentCanvas, 0, 0, thumbWidth, targetHeight);

          resolve(finalCanvas.toDataURL("image/png"));
        };
        img.src = dataUrl;
      });
    }

    function handlePaste(e: ClipboardEvent) {
      e.preventDefault();
      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      let hasImage = false;
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type.startsWith("image/")) {
          hasImage = true;
          const blob = item.getAsFile();
          if (!blob) break;
          const originalName =
            blob.name && blob.name !== "image.png" && blob.name !== "blob"
              ? blob.name
              : undefined;
          const reader = new FileReader();
          reader.onload = async () => {
            const dataUrl = reader.result as string;
            const thumbnailData = await generateThumbnail(dataUrl);
            post({
              type: "createImageFile",
              imageData: dataUrl,
              imageType: item.type,
              thumbnailData,
              originalName,
            } as any);
          };
          reader.readAsDataURL(blob);
          break;
        }
      }

      if (!hasImage) {
        const text = clipboardData.getData("text/plain");
        if (text && textareaRef.current) {
          const ta = textareaRef.current;
          const start = ta.selectionStart;
          const end = ta.selectionEnd;
          ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
          ta.selectionStart = ta.selectionEnd = start + text.length;
          autoResize(ta);
        }
      }
    }

    textarea.addEventListener("paste", handlePaste);

    function handleDragOver(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();
    }

    function handleDrop(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();

      const uriList = e.dataTransfer?.getData("text/uri-list");
      if (uriList) {
        const uris = uriList
          .split("\r\n")
          .filter((u) => u && !u.startsWith("#"));
        if (uris.length > 0) {
          post({ type: "handleDroppedUris", uris } as any);
          return;
        }
      }

      const files = e.dataTransfer?.files;
      if (!files) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith("image/")) {
          const originalName =
            file.name && file.name !== "image.png" && file.name !== "blob"
              ? file.name
              : undefined;
          const reader = new FileReader();
          reader.onload = async () => {
            const dataUrl = reader.result as string;
            const thumbnailData = await generateThumbnail(dataUrl);
            post({
              type: "createImageFile",
              imageData: dataUrl,
              imageType: file.type,
              thumbnailData,
              originalName,
            } as any);
          };
          reader.readAsDataURL(file);
        } else {
          const reader = new FileReader();
          reader.onload = () => {
            const text = reader.result as string;
            post({
              type: "handleDroppedFile",
              fileName: file.name,
              contents: text,
            } as any);
          };
          reader.readAsText(file);
        }
      }
    }

    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      textarea.removeEventListener("paste", handlePaste);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, []);

  return (
    <div class="input-container">
      <QueuedPrompt />
      {sendBlockedHint.value && (
        <div class="send-blocked-hint">Answer the question above first.</div>
      )}
      <div class="model-controls-row">
        <ModelSelector />
        <EffortPicker />
        <ThoughtsToggle />
      </div>
      <div class="textarea-container">
        <div class="textarea-wrapper">
          {images.value.length > 0 && (
            <div class="image-preview-container">
              {images.value.map((img, i) => (
                <div class="image-preview-item" key={img.filePath}>
                  <img src={img.previewUri} alt="preview" />
                  <button
                    class="image-preview-remove"
                    type="button"
                    onClick={() => removeImage(i)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {droppedFiles.value.length > 0 && (
            <div class="dropped-files-container">
              {droppedFiles.value.map((f, i) => (
                <DroppedFile
                  key={`${f.filePath}-${i}`}
                  filePath={f.filePath}
                  contents={f.contents}
                  language={f.language}
                  onRemove={() => {
                    droppedFiles.value = droppedFiles.value.filter(
                      (_, idx) => idx !== i,
                    );
                  }}
                />
              ))}
            </div>
          )}
          <div
            class="textarea-input-wrapper"
            style={terminalMode.value ? { position: "relative" } : undefined}
          >
            {terminalMode.value && (
              <CommandAutocomplete
                commands={commandList.value}
                filter={terminalInput.value}
                onSelect={selectCommand}
              />
            )}
            <textarea
              ref={textareaRef}
              class={`input-field${terminalMode.value ? " terminal-mode" : ""}`}
              placeholder={
                terminalMode.value
                  ? "Slash command — sent straight to Claude Code..."
                  : "Type your message to Claude Code..."
              }
              rows={1}
              onKeyDown={handleKeyDown}
              onInput={handleInput}
              style={
                terminalMode.value
                  ? {
                      borderColor: "var(--terminal-border-color, #00ff41)",
                      color: "var(--terminal-font-color, #00ff41)",
                    }
                  : undefined
              }
            />
          </div>
          <div class="input-controls">
            <div class="left-controls">
              <div class="mode-dropdown-wrapper" ref={modeRootRef}>
                {(() => {
                  const items = modeItems.value;
                  const active = activeMode.value; // 'agent' | 'plan' (the real mode)
                  // Pill shows the configured item for the active mode (honoring a
                  // custom label), falling back to a capitalized id if not listed.
                  const current = items.find((m) => m.id === active);
                  const pillLabel =
                    current?.label ?? active.charAt(0).toUpperCase() + active.slice(1);
                  return (
                    <button
                      class="mode-dropdown-btn"
                      type="button"
                      onClick={() => setModeMenuOpen(!modeMenuOpen)}
                      title="Mode"
                    >
                      <span class="mode-dropdown-icon">{iconForMode(active)}</span>
                      <span class="mode-dropdown-text">{pillLabel}</span>
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 8 8"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M1 2.5l3 3 3-3" />
                      </svg>
                    </button>
                  );
                })()}
                {modeMenuOpen && (
                  <div class="mode-menu" role="listbox">
                    {modeItems.value.map((m) => {
                      const isSel = m.id === activeMode.value;
                      return (
                        <button
                          key={m.id}
                          class={`mode-menu-item${isSel ? " selected" : ""}`}
                          type="button"
                          role="option"
                          aria-selected={isSel}
                          onClick={() => selectMode(m)}
                        >
                          <span class="mode-menu-item-icon">{iconForMode(m.id)}</span>
                          <span class="mode-menu-item-label">{m.label}</span>
                          {isSel && (
                            <span class="mode-menu-item-check">✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div class="right-controls">
              <button
                class="at-btn"
                type="button"
                onClick={() => post({ type: "selectFile" } as any)}
                title="Attach file"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              <button
                class="image-btn"
                type="button"
                onClick={selectImage}
                title="Attach images"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  width="14"
                  height="16"
                >
                  <g fill="currentColor">
                    <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0a1.5 1.5 0 0 1 3 0"></path>
                    <path d="M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2zm13 1a.5.5 0 0 1 .5.5v6l-3.775-1.947a.5.5 0 0 0-.577.093l-3.71 3.71l-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12v.54L1 12.5v-9a.5.5 0 0 1 .5-.5z"></path>
                  </g>
                </svg>
              </button>
              <button
                class="slash-btn"
                type="button"
                onClick={() => {
                  if (terminalMode.value) {
                    exitTerminalMode();
                  } else {
                    const ta = textareaRef.current;
                    if (ta) {
                      ta.value = "/";
                      ta.focus();
                    }
                    enterTerminalMode();
                  }
                }}
                title="Slash commands"
              >
                /
              </button>
              <button
                class="terminal-btn"
                type="button"
                onClick={() => post({ type: "launchColdTerminal" } as any)}
                title="Open a terminal in the project directory"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M6 9l3 3-3 3" />
                  <line x1="12" y1="15" x2="16" y2="15" />
                </svg>
              </button>
              <button
                class="breakout-btn"
                type="button"
                onClick={() =>
                  post({
                    type: "launchSlashCommand",
                    command: "",
                    forceExternal: true,
                  } as any)
                }
                title="Break this session out into a terminal"
              >
                <svg
                  width="16"
                  height="14"
                  viewBox="0 0 16 14"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1"
                >
                  <path d="M12.8 6.5v5q0 .5-.35.85-.3.35-.8.35H2.3q-.5 0-.8-.35a1.16 1.16 0 0 1-.35-.85v-7q0-.45.35-.8.3-.35.8-.35h7m-5.85 2.9L5.2 8 3.45 9.75m3.5 0H9.3M9.4 6.675l5.25-5.25M12.3 1.975l2.35-.55-.6 2.3" />
                </svg>
              </button>
              {canRespawn ? (
                <button
                  class="respawn-btn"
                  type="button"
                  onClick={respawnRequest}
                  title="Respawn the process (re-reads auth) and re-send the failed turn"
                >
                  respawn
                </button>
              ) : !isProcessing ? (
                <button class="send-btn" type="button" onClick={sendMessage}>
                  send
                </button>
              ) : (
                <div class="stop-skull-group">
                  <button
                    class="stop-inline-btn"
                    type="button"
                    onClick={stopRequest}
                    title="Interrupt this turn, keep the session warm"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M6 6h12v12H6z" />
                    </svg>
                    stop
                  </button>
                  <button
                    class="skull-inline-btn"
                    type="button"
                    onClick={skullRequest}
                    title="Hard-kill the process (and subagents) and park the session to History"
                  >
                    💀
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

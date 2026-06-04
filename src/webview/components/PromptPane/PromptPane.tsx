import './PromptPane.less';
import { signal } from '@preact/signals';
import { useState, useRef, useEffect } from 'preact/hooks';
import { post, on } from '../../vscode';
import { processing } from '../../state/session';
import { commandList } from '../../state/commands';
import { ModelSelector } from '../ModelSelector/ModelSelector';
import { DroppedFile } from '../DroppedFile/DroppedFile';
import { CommandAutocomplete } from '../CommandAutocomplete/CommandAutocomplete';
import { slashCommandsVisible } from '../SlashCommands/SlashCommands';

export interface DroppedFileData {
  filePath: string;
  contents: string;
  language: string;
}

const planMode = signal(false);
const thinkingMode = signal(false);
const terminalMode = signal(false);
const terminalInput = signal('');
const images = signal<Array<{ filePath: string; previewUri: string }>>([]);
const droppedFiles = signal<DroppedFileData[]>([]);
const connectMenuOpen = signal(false);

const INLINE_SAFE_COMMANDS = ['compact', 'clear'];

on('imageAttached' as any, (msg: any) => {
  images.value = [...images.value, { filePath: msg.filePath, previewUri: msg.previewUri || msg.thumbnailUri }];
});

on('fileDropped' as any, (msg: any) => {
  const data = msg.data;
  droppedFiles.value = [...droppedFiles.value, { filePath: data.filePath, contents: data.contents, language: data.language }];
});


export function PromptPane() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isProcessing = processing.value;

  function sendMessage() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const userText = textarea.value.trim();
    if (!userText && images.value.length === 0 && droppedFiles.value.length === 0) return;

    let text = '';
    if (droppedFiles.value.length > 0) {
      for (const f of droppedFiles.value) {
        text += `File: ${f.filePath}\n\n\`\`\`${f.language}\n${f.contents}\n\`\`\`\n\n`;
      }
    }
    text += userText;

    post({
      type: 'sendMessage',
      text,
      planMode: planMode.value,
      thinkingMode: thinkingMode.value,
      images: images.value.length > 0 ? images.value : undefined,
    });

    textarea.value = '';
    images.value = [];
    droppedFiles.value = [];
    autoResize(textarea);
  }

  function stopRequest() {
    post({ type: 'stopRequest' } as any);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (terminalMode.value) {
      if (e.key === 'Escape') {
        e.preventDefault();
        exitTerminalMode();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        executeTerminalCommand(false);
        return;
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInput(e: Event) {
    const textarea = e.currentTarget as HTMLTextAreaElement;
    autoResize(textarea);

    if (terminalMode.value) {
      if (!textarea.value.startsWith('/')) {
        exitTerminalMode();
        return;
      }
      terminalInput.value = textarea.value;
    } else if (textarea.value === '/' && textarea.selectionStart === 1) {
      enterTerminalMode();
    }
  }

  function enterTerminalMode() {
    terminalMode.value = true;
    terminalInput.value = '/';
    post({ type: 'fetchCommandList' } as any);
  }

  function exitTerminalMode() {
    terminalMode.value = false;
    terminalInput.value = '';
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.value = '';
      autoResize(textarea);
    }
  }

  function executeTerminalCommand(forceExternal: boolean) {
    const command = terminalInput.value || textareaRef.current?.value || '';
    if (!command.trim()) return;
    post({ type: 'launchSlashCommand', command: command.trim(), forceExternal } as any);
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

  function isCommandExternal(): boolean {
    const cmdName = terminalInput.value.replace(/^\//, '').split(/\s+/)[0];
    return !INLINE_SAFE_COMMANDS.includes(cmdName);
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function togglePlan() {
    planMode.value = !planMode.value;
    if (planMode.value) {
      post({ type: 'showInfoMessage', message: 'Plan mode enabled — Claude will plan before making changes.' } as any);
    }
  }

  function toggleThinking() {
    thinkingMode.value = !thinkingMode.value;
  }

  function selectImage() {
    post({ type: 'selectImageFile' } as any);
  }

  function removeImage(index: number) {
    images.value = images.value.filter((_, i) => i !== index);
  }

  function toggleConnectMenu() {
    connectMenuOpen.value = !connectMenuOpen.value;
  }

  function hideConnectMenu() {
    connectMenuOpen.value = false;
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

          let currentCanvas = document.createElement('canvas');
          currentCanvas.width = img.width;
          currentCanvas.height = img.height;
          let ctx = currentCanvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0);

          let currentWidth = img.width;
          let currentHeight = img.height;

          while (currentWidth > thumbWidth * 1.5) {
            const nextWidth = Math.max(thumbWidth, Math.round(currentWidth * 0.5));
            const nextHeight = Math.round((nextWidth / currentWidth) * currentHeight);
            const nextCanvas = document.createElement('canvas');
            nextCanvas.width = nextWidth;
            nextCanvas.height = nextHeight;
            const nextCtx = nextCanvas.getContext('2d')!;
            nextCtx.imageSmoothingEnabled = true;
            nextCtx.imageSmoothingQuality = 'high';
            nextCtx.drawImage(currentCanvas, 0, 0, nextWidth, nextHeight);
            currentCanvas = nextCanvas;
            currentWidth = nextWidth;
            currentHeight = nextHeight;
          }

          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = thumbWidth;
          finalCanvas.height = targetHeight;
          const finalCtx = finalCanvas.getContext('2d')!;
          finalCtx.imageSmoothingEnabled = true;
          finalCtx.imageSmoothingQuality = 'high';
          finalCtx.drawImage(currentCanvas, 0, 0, thumbWidth, targetHeight);

          resolve(finalCanvas.toDataURL('image/png'));
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
        if (item.type.startsWith('image/')) {
          hasImage = true;
          const blob = item.getAsFile();
          if (!blob) break;
          const originalName = blob.name && blob.name !== 'image.png' && blob.name !== 'blob' ? blob.name : undefined;
          const reader = new FileReader();
          reader.onload = async () => {
            const dataUrl = reader.result as string;
            const thumbnailData = await generateThumbnail(dataUrl);
            post({ type: 'createImageFile', imageData: dataUrl, imageType: item.type, thumbnailData, originalName } as any);
          };
          reader.readAsDataURL(blob);
          break;
        }
      }

      if (!hasImage) {
        const text = clipboardData.getData('text/plain');
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

    textarea.addEventListener('paste', handlePaste);

    function handleDragOver(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();
    }

    function handleDrop(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();

      const uriList = e.dataTransfer?.getData('text/uri-list');
      if (uriList) {
        const uris = uriList.split('\r\n').filter(u => u && !u.startsWith('#'));
        if (uris.length > 0) {
          post({ type: 'handleDroppedUris', uris } as any);
          return;
        }
      }

      const files = e.dataTransfer?.files;
      if (!files) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/')) {
          const originalName = file.name && file.name !== 'image.png' && file.name !== 'blob' ? file.name : undefined;
          const reader = new FileReader();
          reader.onload = async () => {
            const dataUrl = reader.result as string;
            const thumbnailData = await generateThumbnail(dataUrl);
            post({ type: 'createImageFile', imageData: dataUrl, imageType: file.type, thumbnailData, originalName } as any);
          };
          reader.readAsDataURL(file);
        } else {
          const reader = new FileReader();
          reader.onload = () => {
            const text = reader.result as string;
            post({ type: 'handleDroppedFile', fileName: file.name, contents: text } as any);
          };
          reader.readAsText(file);
        }
      }
    }

    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);

    return () => {
      textarea.removeEventListener('paste', handlePaste);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, []);

  return (
    <div class="input-container">
      <ModelSelector />
      <div class="textarea-container">
        <div class="textarea-wrapper">
          {images.value.length > 0 && (
            <div class="image-preview-container">
              {images.value.map((img, i) => (
                <div class="image-preview-item" key={img.filePath}>
                  <img src={img.previewUri} alt="preview" />
                  <button class="image-preview-remove" type="button" onClick={() => removeImage(i)}>×</button>
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
                  onRemove={() => { droppedFiles.value = droppedFiles.value.filter((_, idx) => idx !== i); }}
                />
              ))}
            </div>
          )}
          <div class="textarea-input-wrapper" style={terminalMode.value ? { position: 'relative' } : undefined}>
            {terminalMode.value && (
              <CommandAutocomplete
                commands={commandList.value}
                filter={terminalInput.value}
                onSelect={selectCommand}
              />
            )}
            <textarea
              ref={textareaRef}
              class={`input-field${terminalMode.value ? ' terminal-mode' : ''}`}
              placeholder={terminalMode.value ? 'Type a slash command...' : 'Type your message to Claude Code...'}
              rows={1}
              onKeyDown={handleKeyDown}
              onInput={handleInput}
              style={terminalMode.value ? { borderColor: 'var(--terminal-border-color, #00ff41)', color: 'var(--terminal-font-color, #00ff41)' } : undefined}
            />
            {terminalMode.value && (
              <button
                class={`terminal-launch-icon ${isCommandExternal() ? 'terminal-launch-icon--active' : ''}`}
                type="button"
                title={isCommandExternal() ? 'Will launch in external terminal' : 'Click to force external terminal'}
                onClick={() => executeTerminalCommand(true)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
            )}
          </div>
          <div class="input-controls">
            <div class="left-controls">
              <div class="connect-dropdown-wrapper">
                <button class="input-dropdown-btn" type="button" onClick={toggleConnectMenu}>
                  <span>Add</span>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M1 2.5l3 3 3-3"></path></svg>
                </button>
                {connectMenuOpen.value && (
                  <div class="connect-menu">
                    <div class="connect-menu-header">Add</div>
                    <button class="connect-menu-item" type="button" onClick={() => { hideConnectMenu(); post({ type: 'showPluginsModal' } as any); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                      <span>Plugins</span>
                    </button>
                    <button class="connect-menu-item" type="button" onClick={() => { hideConnectMenu(); post({ type: 'showSkillsModal' } as any); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                      <span>Skills</span>
                    </button>
                    <button class="connect-menu-item" type="button" onClick={() => { hideConnectMenu(); post({ type: 'showMCPModal' } as any); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/></svg>
                      <span>MCP Servers</span>
                    </button>
                  </div>
                )}
              </div>
              <button class={`input-toggle-btn${planMode.value ? ' active' : ''}`} type="button" onClick={togglePlan}>Plan</button>
              <button class={`input-toggle-btn${thinkingMode.value ? ' active' : ''}`} type="button" onClick={toggleThinking}>
                {thinkingMode.value ? (
                  <>
                    <span style="color:#d4735c">U</span>
                    <span style="color:#d49a52">l</span>
                    <span style="color:#c4a84e">t</span>
                    <span style="color:#a8b85a">r</span>
                    <span style="color:#6ab87a">a</span>
                    <span style="color:#52b8a8">t</span>
                    <span style="color:#5a9ed4">h</span>
                    <span style="color:#7a7ec8">i</span>
                    <span style="color:#a864b8">n</span>
                    <span style="color:#c85aa0">k</span>
                  </>
                ) : 'Ultrathink'}
              </button>
            </div>
            <div class="right-controls">
              <button class="slash-btn" type="button" onClick={() => { if (terminalMode.value) { exitTerminalMode(); } else { const ta = textareaRef.current; if (ta) { ta.value = '/'; ta.focus(); } enterTerminalMode(); } }} title="Slash commands">/</button>
              <button class="at-btn" type="button" onClick={() => post({ type: 'selectFile' } as any)} title="Attach file">@</button>
              <button class="image-btn" type="button" onClick={selectImage} title="Attach images">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="16">
                  <g fill="currentColor">
                    <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0a1.5 1.5 0 0 1 3 0"></path>
                    <path d="M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2zm13 1a.5.5 0 0 1 .5.5v6l-3.775-1.947a.5.5 0 0 0-.577.093l-3.71 3.71l-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12v.54L1 12.5v-9a.5.5 0 0 1 .5-.5z"></path>
                  </g>
                </svg>
              </button>
              <button class="breakout-btn" type="button" onClick={() => post({ type: 'launchSlashCommand', command: '', forceExternal: true } as any)} title="Open in external terminal">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
              {!isProcessing ? (
                <button class="send-btn" type="button" onClick={sendMessage}>
                  <div>
                    <span>Send </span>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11">
                      <path fill="currentColor" d="M20 4v9a4 4 0 0 1-4 4H6.914l2.5 2.5L8 20.914L3.086 16L8 11.086L9.414 12.5l-2.5 2.5H16a2 2 0 0 0 2-2V4z"></path>
                    </svg>
                  </div>
                </button>
              ) : (
                <button class="stop-inline-btn" type="button" onClick={stopRequest}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 6h12v12H6z"/>
                  </svg>
                  Stop
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

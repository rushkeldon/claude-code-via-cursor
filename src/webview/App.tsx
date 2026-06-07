import './globals.less';
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { post } from './vscode';
import { Header } from './components/Header/Header';
import { ConversationHistory } from './components/ConversationHistory/ConversationHistory';
import { MessagesList } from './components/MessagesList/MessagesList';
import { AuthErrorCard } from './components/AuthErrorCard/AuthErrorCard';
import { PromptPane } from './components/PromptPane/PromptPane';
import { SessionStatus } from './components/SessionStatus/SessionStatus';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { SlashCommandsModal } from './components/SlashCommands/SlashCommands';
import { FirstRun } from './components/FirstRun/FirstRun';

const draggingOver = signal(false);
let dragCounter = 0;

export function App() {
  useEffect(() => {
    // Tell the host the webview has mounted and its message listeners are live.
    // The host defers firstRunPrompt until this arrives — posting it earlier
    // would drop it, since the message bus doesn't buffer pre-mount messages.
    post({ type: 'webviewReady' });
  }, []);

  useEffect(() => {
    function onDragEnter(e: DragEvent) {
      e.preventDefault();
      dragCounter++;
      draggingOver.value = true;
    }
    function onDragLeave(e: DragEvent) {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        draggingOver.value = false;
      }
    }
    function onDrop() {
      dragCounter = 0;
      draggingOver.value = false;
    }
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <main class="app-root">
      {draggingOver.value && (
        <div class="drop-overlay">
          <div class="drop-overlay-label">Drop files here</div>
        </div>
      )}
      <Header />
      <ConversationHistory />
      <MessagesList />
      <AuthErrorCard />
      <PromptPane />
      <SessionStatus />
      <SettingsModal />
      <SlashCommandsModal />
      <FirstRun />
    </main>
  );
}

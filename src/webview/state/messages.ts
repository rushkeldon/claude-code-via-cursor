import { signal } from '@preact/signals';
import { on } from '../vscode';
import { flushThinkingToPill } from '../components/ThinkingPane/ThinkingPane';

export interface QuestionData {
  id: string;
  questions: Array<{
    header?: string;
    question: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
  status: 'answered' | 'expired' | 'cancelled';
  answers?: Record<string, string>;
  // Raw input state captured at submit/cancel time, keyed by question index, so
  // the resolved (collapsed) card can re-render the exact controls the user left:
  // which options were checked, and any text they typed. Preserved on cancel too.
  selections?: Record<number, string[]>;
  freeTexts?: Record<number, string>;
}

export interface PermissionData {
  id: string;
  tool: string;
  input: Record<string, any>;
  pattern?: string;
  status: 'approved' | 'denied' | 'expired' | 'cancelled';
}

export type NoticeVariant = 'warning' | 'info' | 'success';

export interface ChatMsg {
  role: 'user' | 'assistant' | 'system' | 'error' | 'thinking' | 'question' | 'permission' | 'notice' | 'tool' | 'tool-result';
  content: string;
  images?: Array<{ filePath: string; previewUri: string }>;
  elapsedLabel?: string;
  timestamp?: number;
  questionData?: QuestionData;
  permissionData?: PermissionData;
  noticeVariant?: NoticeVariant;
  noticeTitle?: string;
  toolName?: string;
  toolInput?: string;
  rawInput?: any;
  isError?: boolean;
  hidden?: boolean;
}

export const messages = signal<ChatMsg[]>([]);

on('userInput', (msg) => {
  messages.value = [...messages.value, {
    role: 'user',
    content: msg.data || '',
    images: msg.images,
    timestamp: Date.now(),
  }];
});

on('output' as any, (msg: any) => {
  messages.value = [...messages.value, {
    role: 'assistant',
    content: msg.data || '',
    timestamp: Date.now(),
  }];
  flushThinkingToPill();
});

on('error', (msg) => {
  messages.value = [...messages.value, {
    role: 'error',
    content: msg.data || '',
    timestamp: Date.now(),
  }];
});

on('toolUse' as any, (msg: any) => {
  const data = msg.data || {};
  let displayInput = data.toolInput || '';
  if (!displayInput && data.rawInput) {
    if (data.toolName === 'Bash' && data.rawInput.command) {
      displayInput = data.rawInput.command;
    } else if (data.rawInput.file_path) {
      displayInput = data.rawInput.file_path;
    }
  }
  messages.value = [...messages.value, {
    role: 'tool',
    content: displayInput,
    toolName: data.toolName,
    toolInput: displayInput,
    rawInput: data.rawInput,
    timestamp: Date.now(),
  }];
});

on('toolResult' as any, (msg: any) => {
  const data = msg.data || {};
  if (data.hidden) return;
  messages.value = [...messages.value, {
    role: 'tool-result',
    content: typeof data.content === 'string' ? data.content : JSON.stringify(data.content),
    toolName: data.toolName,
    isError: data.isError,
    timestamp: Date.now(),
  }];
});

on('loadConversation' as any, (msg: any) => {
  const batch = msg.data || [];
  const items: ChatMsg[] = [];
  for (const entry of batch) {
    const data = entry.data;
    switch (entry.type) {
      case 'userInput':
        items.push({ role: 'user', content: data || '', images: entry.images, timestamp: Date.now() });
        break;
      case 'output':
        items.push({ role: 'assistant', content: data || '', timestamp: Date.now() });
        break;
      case 'error':
        items.push({ role: 'error', content: data || '', timestamp: Date.now() });
        break;
      case 'thinking':
        items.push({ role: 'thinking', content: data || '', elapsedLabel: '?', timestamp: Date.now() });
        break;
      case 'toolUse': {
        let displayInput = data?.toolInput || '';
        if (!displayInput && data?.rawInput) {
          if (data.toolName === 'Bash' && data.rawInput.command) displayInput = data.rawInput.command;
          else if (data.rawInput.file_path) displayInput = data.rawInput.file_path;
        }
        items.push({ role: 'tool', content: displayInput, toolName: data?.toolName, toolInput: displayInput, rawInput: data?.rawInput, timestamp: Date.now() });
        break;
      }
      case 'toolResult': {
        if (data?.hidden) break;
        items.push({ role: 'tool-result', content: typeof data?.content === 'string' ? data.content : JSON.stringify(data?.content), toolName: data?.toolName, isError: data?.isError, timestamp: Date.now() });
        break;
      }
      case 'askUserQuestion':
        items.push({ role: 'question', content: '', questionData: data, timestamp: Date.now() });
        break;
      case 'permissionRequest':
        items.push({ role: 'permission', content: '', permissionData: data, timestamp: Date.now() });
        break;
      default:
        break;
    }
  }
  messages.value = items;
});

on('notice' as any, (msg: any) => {
  const data = msg.data || {};
  messages.value = [...messages.value, {
    role: 'notice',
    content: data.content || '',
    noticeVariant: data.variant || 'warning',
    noticeTitle: data.title || 'Notice',
    timestamp: Date.now(),
  }];
});

on('newSession' as any, () => {
  messages.value = [];
});

export function pushNotice(title: string, content: string, variant: NoticeVariant = 'warning') {
  messages.value = [...messages.value, {
    role: 'notice',
    content,
    noticeVariant: variant,
    noticeTitle: title,
    timestamp: Date.now(),
  }];
}

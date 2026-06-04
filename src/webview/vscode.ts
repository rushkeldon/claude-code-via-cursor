declare function acquireVsCodeApi(): { postMessage(msg: any): void };
const vscode = acquireVsCodeApi();

export type MessageToExtension =
  | { type: 'sendMessage'; text: string; planMode: boolean; thinkingMode: boolean; images?: Array<{ filePath: string; previewUri: string }> }
  | { type: 'webviewReady' }
  | { type: 'firstRunShown' }
  | { type: 'getDetectedTerminals' }
  | { type: 'newSession' }
  | { type: 'requestIdentityProfile' }
  | { type: 'requestSettings' }
  | { type: 'copyToClipboard'; text: string }
  | { type: 'getSettings' }
  | { type: 'updateSettings'; settings: Record<string, any> }
  | { type: 'getPermissions' }
  | { type: 'addPermission'; toolName: string; command: string | null }
  | { type: 'removePermission'; toolName: string; command: string | null }

export type MessageFromExtension =
  | { type: 'ready'; data: string }
  | { type: 'identityProfile'; data: { profile: string | null; healthy: boolean } }
  | { type: 'output'; data: string }
  | { type: 'thinking'; data: string }
  | { type: 'thinkingDelta'; data: string }
  | { type: 'thinkingBlockStart' }
  | { type: 'error'; data: string }
  | { type: 'userInput'; data: string; images?: any }
  | { type: 'setProcessing'; data: { isProcessing: boolean } }
  | { type: 'sessionId'; data: string }
  | { type: 'conversationList'; data: any[] }
  | { type: 'imageAttached'; filePath: string; thumbnailUri: string }
  | { type: 'authError'; data: { rawError: string } }
  | { type: 'processStalled'; data: { sinceLastMs: number } }
  | { type: 'stallHintClear' }
  | { type: 'modelSwitching'; data: { model: string } }
  | { type: 'modelFull'; data: { configured?: string; resolvedEnv?: string } }
  | { type: 'detectedTerminals'; data: { terminals: string[]; platform: string } }
  | { type: 'updateTokens'; data: any }
  | { type: 'updateTotals'; data: any }
  | { type: 'settingsData'; data: any }
  | { type: 'permissionsData'; data: any }

export function post(msg: MessageToExtension): void {
  vscode.postMessage(msg);
}

const listeners = new Map<string, Array<(payload: any) => void>>();

window.addEventListener('message', (e) => {
  const handlers = listeners.get(e.data?.type) ?? [];
  for (const h of handlers) h(e.data);
});

export function on<T extends MessageFromExtension['type']>(
  type: T,
  handler: (msg: Extract<MessageFromExtension, { type: T }>) => void,
): () => void {
  const arr = listeners.get(type) ?? [];
  arr.push(handler as any);
  listeners.set(type, arr);
  return () => {
    const a = listeners.get(type) ?? [];
    listeners.set(type, a.filter(h => h !== handler));
  };
}

import * as vscode from 'vscode';
import * as path from 'path';
import * as tokenCounters from './tokenCounters';
import { log } from './logger';
import { deleteSessionImages } from './sessionImages';
import * as settings from './settings';

type PostMessageFn = (message: any) => void;

interface ConversationData {
	sessionId: string;
	startTime: string | undefined;
	endTime: string;
	messageCount: number;
	totalCost: number;
	totalTokens: {
		input: number;
		output: number;
	};
	messages: Array<{ timestamp: string; messageType: string; data: any }>;
	filename?: string;
	// Model-generated session title (see sessionTitle.ts). `title` is the
	// descriptive label shown in the History list (falls back to firstUserMessage
	// when absent). `titleLocked` becomes true once the final (6-turn) title is
	// issued, so a resumed session never re-fires title generation.
	title?: string;
	titleLocked?: boolean;
	// Per-conversation spawn preferences (model/effort/thoughts). Portable across
	// IDE ports; used by eager first-spawn to resume with the conversation's own
	// settings. Missing fields fall through to workspaceState/config defaults.
	model?: string;
	effort?: string;
	thoughtsOn?: boolean;
}

interface ConversationDeps {
	postMessage: PostMessageFn;
	workspaceState: vscode.Memento;
}

let deps: ConversationDeps | undefined;
let conversationsPath: string | undefined;
let currentConversation: Array<{ timestamp: string; messageType: string; data: any }> = [];
let conversationStartTime: string | undefined;
let currentSessionId: string | undefined;
let conversationIndex: Array<{
	filename: string;
	sessionId: string;
	startTime: string;
	endTime: string;
	messageCount: number;
	totalCost: number;
	firstUserMessage: string;
	lastUserMessage: string;
	title?: string;
	titleLocked?: boolean;
}> = [];

// Model-generated title for the in-flight conversation. Persisted into each
// saved ConversationData and its index entry. `currentTitleLocked` guards
// against re-firing the final (6-turn) generation on a resumed session.
let currentTitle: string | undefined;
let currentTitleLocked = false;

export function init(d: ConversationDeps): void {
	log.info('Conversation', 'init', { hasPostMessage: !!d.postMessage }, '🔧');
	deps = d;
	conversationIndex = d.workspaceState.get('claude.conversationIndex', []);
	log.debug('Conversation', 'loaded conversation index', { indexCount: conversationIndex.length }, '📥');
}

export function getCurrentSessionId(): string | undefined {
	return currentSessionId;
}

export function setCurrentSessionId(id: string | undefined): void {
	log.debug('Conversation', 'setCurrentSessionId', { id }, '⚙️');
	currentSessionId = id;
}

export function getCurrentConversation(): typeof currentConversation {
	return currentConversation;
}

export function getConversationStartTime(): string | undefined {
	return conversationStartTime;
}

export function getConversationsPath(): string | undefined {
	return conversationsPath;
}

export function getLatestConversation(): any | undefined {
	return conversationIndex.length > 0 ? conversationIndex[0] : undefined;
}

export function getConversationIndex(): typeof conversationIndex {
	return conversationIndex;
}

// Resolve spawn prefs for eager first-spawn: prioritize the conversation's saved
// prefs (portable), fall back to workspaceState (transitional), then config default.
// Missing conversation fields (old records) silently fall through the chain.
export function resolveSpawnPrefs(conversationData?: ConversationData | { model?: string; effort?: string; thoughtsOn?: boolean }): {
	model: string;
	effort: string | undefined;
	thoughtsOn: boolean;
} {
	const model = conversationData?.model || settings.getSelectedModel();
	const effort = conversationData?.effort !== undefined ? conversationData.effort : settings.getEffort();
	const thoughtsOn = conversationData?.thoughtsOn !== undefined ? conversationData.thoughtsOn : settings.getThoughtsOn();
	log.debug('Conversation', 'resolveSpawnPrefs', { model, effort, thoughtsOn, hadConvPrefs: !!conversationData?.model }, '🔍');
	return { model, effort, thoughtsOn };
}

export function sendConversationList(): void {
	log.debug('Conversation', 'enter sendConversationList', { count: conversationIndex.length }, '➡️');
	deps?.postMessage({
		type: 'conversationList',
		data: conversationIndex
	});
	log.debug('Conversation', 'exit sendConversationList', undefined, '⬅️');
}

export function sendAndSaveMessage(message: { type: string; data: any; images?: any }): void {
	if (currentConversation.length === 0) {
		conversationStartTime = new Date().toISOString();
		log.debug('Conversation', 'first message — set conversationStartTime', { conversationStartTime }, '🌱');
	}

	const messageIndex = currentConversation.length;

	const messageToSend = (message.type === 'toolUse' || message.type === 'toolResult')
		? { ...message, data: { ...message.data, messageIndex } }
		: message;

	deps?.postMessage(messageToSend);

	let dataToSave = message.data;
	if (message.type === 'toolUse' || message.type === 'toolResult') {
		const { fileContentBefore, fileContentAfter, ...rest } = message.data || {};
		dataToSave = rest;
	}

	currentConversation.push({
		timestamp: new Date().toISOString(),
		messageType: message.type,
		data: dataToSave
	});

	void saveCurrentConversation();
	log.debug('Conversation', 'sendAndSaveMessage', { messageIndex, type: message.type }, '💾');
}

// Serializes saves so two overlapping writes (e.g. a per-message save and a
// title-triggered save) can never interleave and truncate the file. Each call
// chains onto the previous one's completion.
let saveChain: Promise<void> = Promise.resolve();

export function saveCurrentConversation(): Promise<void> {
	saveChain = saveChain.then(() => doSaveCurrentConversation()).catch(() => { /* logged inside */ });
	return saveChain;
}

async function doSaveCurrentConversation(): Promise<void> {
	if (!conversationsPath || currentConversation.length === 0) { return; }
	if (!currentSessionId) { return; }

	try {
		const firstUserMessage = currentConversation.find(m => m.messageType === 'userInput');
		const firstMessage = firstUserMessage ? firstUserMessage.data : 'conversation';
		const startTime = conversationStartTime || new Date().toISOString();
		const sessionId = currentSessionId || 'unknown';

		const cleanMessage = firstMessage
			.replace(/[^a-zA-Z0-9\s]/g, '')
			.replace(/\s+/g, '-')
			.substring(0, 50)
			.toLowerCase();

		const datePrefix = startTime.substring(0, 16).replace('T', '_').replace(/:/g, '-');
		const filename = `${datePrefix}_${cleanMessage}.json`;

		const saveTotals = tokenCounters.getTotals();
		const conversationData: ConversationData = {
			sessionId: sessionId,
			startTime: conversationStartTime,
			endTime: new Date().toISOString(),
			messageCount: currentConversation.length,
			totalCost: saveTotals.totalCost,
			totalTokens: {
				input: saveTotals.totalTokensInput,
				output: saveTotals.totalTokensOutput
			},
			messages: currentConversation,
			filename,
			title: currentTitle,
			titleLocked: currentTitleLocked,
			model: settings.getSelectedModel(),
			effort: settings.getEffort(),
			thoughtsOn: settings.getThoughtsOn()
		};

		const filePath = path.join(conversationsPath, filename);
		const content = new TextEncoder().encode(JSON.stringify(conversationData, null, 2));

		// Atomic write: write to a temp file, then rename over the target. A rename
		// is atomic on the same filesystem, so a reader never sees a half-written
		// (0-byte / truncated) file even if the process dies mid-write.
		const tmpPath = `${filePath}.tmp`;
		const tmpUri = vscode.Uri.file(tmpPath);
		await vscode.workspace.fs.writeFile(tmpUri, content);
		await vscode.workspace.fs.rename(tmpUri, vscode.Uri.file(filePath), { overwrite: true });

		updateConversationIndex(filename, conversationData);

	} catch (error: any) {
		log.error('Conversation', 'saveCurrentConversation failed', { error: error?.message ?? String(error) }, '💥');
	}
}

// Park the active session to history: force a final save (guaranteeing an index
// entry) and refresh the conversation list so the History panel shows it as a
// resumable entry. Used by Skull (hard kill) and extension deactivate. Saving
// already happens per-message, so this is the belt-and-suspenders final flush.
export async function parkToHistory(): Promise<void> {
	log.info('Conversation', 'parkToHistory', { sessionId: currentSessionId, messages: currentConversation.length }, '🅿️');
	await saveCurrentConversation();
	sendConversationList();
}

export async function initializeConversations(storagePath: string | undefined): Promise<void> {
	log.debug('Conversation', 'enter initializeConversations', { storagePath }, '➡️');
	try {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			log.debug('Conversation', 'no workspace folder, skipping', undefined, '🚫');
			return;
		}

		if (!storagePath) {
			log.debug('Conversation', 'no storage path, skipping', undefined, '🚫');
			return;
		}

		conversationsPath = path.join(storagePath, 'conversations');

		try {
			await vscode.workspace.fs.stat(vscode.Uri.file(conversationsPath));
		} catch {
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(conversationsPath));
			log.debug('Conversation', 'created conversations directory', { conversationsPath }, '🧱');
		}
		log.debug('Conversation', 'exit initializeConversations', { conversationsPath }, '⬅️');
	} catch (error: any) {
		log.error('Conversation', 'initializeConversations failed', { error: error?.message ?? String(error) }, '💥');
	}
}

export async function loadConversationData(filename: string): Promise<ConversationData | undefined> {
	log.debug('Conversation', 'enter loadConversationData', { filename }, '➡️');
	if (!conversationsPath) {
		log.debug('Conversation', 'no conversations path', undefined, '🚫');
		return undefined;
	}

	try {
		const filePath = path.join(conversationsPath, filename);
		const fileUri = vscode.Uri.file(filePath);
		const content = await vscode.workspace.fs.readFile(fileUri);
		const data = JSON.parse(new TextDecoder().decode(content));
		log.debug('Conversation', 'exit loadConversationData', { filename, messageCount: data.messageCount }, '⬅️');
		return data;
	} catch (error: any) {
		log.error('Conversation', 'loadConversationData failed', { filename, error: error?.message ?? String(error) }, '💥');
		return undefined;
	}
}

export function setConversationState(messages: Array<{ timestamp: string; messageType: string; data: any }>, startTime: string | undefined, title?: string, titleLocked?: boolean): void {
	log.debug('Conversation', 'setConversationState', { messageCount: messages.length, startTime, hasTitle: !!title, titleLocked: !!titleLocked }, '🔄');
	currentConversation = messages;
	conversationStartTime = startTime;
	currentTitle = title;
	currentTitleLocked = !!titleLocked;
}

export function newSession(): void {
	log.info('Conversation', 'newSession', { previousSessionId: currentSessionId, previousMessageCount: currentConversation.length }, '🌱');
	currentSessionId = undefined;
	currentConversation = [];
	conversationStartTime = undefined;
	currentTitle = undefined;
	currentTitleLocked = false;
}

// ── Session title state ─────────────────────────────────────────────────────
// Driven by subprocess.onTurnEnd's 3-then-6 schedule (see sessionTitle.ts).

export function getCurrentTitle(): string | undefined {
	return currentTitle;
}

export function isTitleLocked(): boolean {
	return currentTitleLocked;
}

// Count of user turns so far (userInput messages) — the unit the title schedule
// keys off. NOT currentConversation.length (which counts every stream event).
export function getUserTurnCount(): number {
	return currentConversation.filter(m => m.messageType === 'userInput').length;
}

// Store a generated title. `locked` marks the final (6-turn) title so it never
// regenerates. Persists immediately and refreshes the History list.
export function setSessionTitle(title: string, locked: boolean): void {
	log.info('Conversation', 'setSessionTitle', { title, locked }, '🏷️');
	currentTitle = title;
	if (locked) { currentTitleLocked = true; }
	void saveCurrentConversation().then(() => sendConversationList());
}

export async function deleteConversation(filename: string): Promise<void> {
	log.info('Conversation', 'deleteConversation', { filename }, '🗑️');
	if (!conversationsPath) { return; }

	try {
		const filePath = path.join(conversationsPath, filename);
		const fileUri = vscode.Uri.file(filePath);

		// Resolve the conversation's session id (from the file, falling back to the
		// index entry if the JSON is missing/unreadable) and delete its images by
		// the <sessionId>_ filename prefix before removing the conversation.
		const indexEntry = conversationIndex.find(entry => entry.filename === filename);
		let sessionId: string | undefined = indexEntry?.sessionId;
		try {
			const content = await vscode.workspace.fs.readFile(fileUri);
			const data = JSON.parse(new TextDecoder().decode(content));
			sessionId = data.sessionId || sessionId;
		} catch {
			// File may not exist or be unreadable — fall back to the index entry's id.
		}
		cleanupConversationImages(sessionId);

		// Delete the conversation file
		try {
			await vscode.workspace.fs.delete(fileUri);
		} catch {
			// Already gone
		}

		// Remove from index
		conversationIndex = conversationIndex.filter(entry => entry.filename !== filename);
		deps?.workspaceState.update('claude.conversationIndex', conversationIndex);

		log.info('Conversation', 'deleteConversation complete', { filename, remainingCount: conversationIndex.length }, '✅');
	} catch (error: any) {
		log.error('Conversation', 'deleteConversation failed', { filename, error: error?.message ?? String(error) }, '💥');
	}
}

// Delete a conversation's images by session-id filename prefix (img/<sessionId>_*).
// Images are associated with their conversation solely by this prefix — no longer by
// parsing msg.data.images (which was never persisted, so the old walk matched nothing).
function cleanupConversationImages(sessionId: string | undefined): void {
	deleteSessionImages(sessionId);
}

function cleanSessionTitle(raw: string): string {
	let text = raw.trim();
	const prefixes = [
		/^(okay|ok|alright|hey|hi|so|well|now)\b[.,!]?\s*/i,
		/^(go ahead and|please|can you|could you|i want you to|i'd like you to)\s*/i,
		/^use the modes skill to\s*/i,
		/^(enter|exit)\s+(plan|agent|sbs|one-word)\s+mode\s*/i,
		/^\/\w+\s*/,
		/^ULTRATHINK[^:]*:\s*/i,
		/^THINK[^:]*:\s*/i,
	];
	for (const p of prefixes) {
		text = text.replace(p, '');
	}
	text = text.replace(/^\s*[.,!]\s*/, '');
	if (text.length < 5 && raw.length > text.length) {
		text = raw.trim();
	}
	return text.substring(0, 80);
}

function updateConversationIndex(filename: string, conversationData: ConversationData): void {
	const userMessages = conversationData.messages.filter((m: any) => m.messageType === 'userInput');
	let firstUserMessage = userMessages.length > 0 ? userMessages[0].data : 'No user message';
	for (const msg of userMessages) {
		const cleaned = cleanSessionTitle(msg.data || '');
		if (cleaned.length >= 10) {
			firstUserMessage = cleaned;
			break;
		}
	}
	firstUserMessage = cleanSessionTitle(firstUserMessage);
	const lastUserMessage = userMessages.length > 0 ? userMessages[userMessages.length - 1].data : firstUserMessage;

	const indexEntry = {
		filename: filename,
		sessionId: conversationData.sessionId,
		startTime: conversationData.startTime || '',
		endTime: conversationData.endTime,
		messageCount: conversationData.messageCount,
		totalCost: conversationData.totalCost,
		firstUserMessage: firstUserMessage.substring(0, 100),
		lastUserMessage: lastUserMessage.substring(0, 100),
		title: conversationData.title,
		titleLocked: conversationData.titleLocked
	};

	conversationIndex = conversationIndex.filter(entry => entry.filename !== conversationData.filename);
	conversationIndex.unshift(indexEntry);

	if (conversationIndex.length > 100) {
		conversationIndex = conversationIndex.slice(0, 100);
		log.debug('Conversation', 'pruned conversation index to 100', undefined, '🧹');
	}

	deps?.workspaceState.update('claude.conversationIndex', conversationIndex);
	log.debug('Conversation', 'updateConversationIndex', { filename, indexCount: conversationIndex.length }, '📇');
}

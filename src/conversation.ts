import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as tokenCounters from './tokenCounters';
import { log } from './logger';

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
}> = [];

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

export async function saveCurrentConversation(): Promise<void> {
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
			filename
		};

		const filePath = path.join(conversationsPath, filename);
		const content = new TextEncoder().encode(JSON.stringify(conversationData, null, 2));
		await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), content);

		updateConversationIndex(filename, conversationData);

	} catch (error: any) {
		log.error('Conversation', 'saveCurrentConversation failed', { error: error?.message ?? String(error) }, '💥');
	}
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

export function setConversationState(messages: Array<{ timestamp: string; messageType: string; data: any }>, startTime: string | undefined): void {
	log.debug('Conversation', 'setConversationState', { messageCount: messages.length, startTime }, '🔄');
	currentConversation = messages;
	conversationStartTime = startTime;
}

export function newSession(): void {
	log.info('Conversation', 'newSession', { previousSessionId: currentSessionId, previousMessageCount: currentConversation.length }, '🌱');
	currentSessionId = undefined;
	currentConversation = [];
	conversationStartTime = undefined;
}

export async function deleteConversation(filename: string): Promise<void> {
	log.info('Conversation', 'deleteConversation', { filename }, '🗑️');
	if (!conversationsPath) { return; }

	try {
		const filePath = path.join(conversationsPath, filename);
		const fileUri = vscode.Uri.file(filePath);

		// Load conversation to find image paths before deleting
		try {
			const content = await vscode.workspace.fs.readFile(fileUri);
			const data = JSON.parse(new TextDecoder().decode(content));
			cleanupConversationImages(data.messages || []);
		} catch {
			// File may not exist or be unreadable — proceed with index cleanup
		}

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

function cleanupConversationImages(messages: Array<{ messageType: string; data: any }>): void {
	const imgDir = path.join(os.homedir(), 'Library', 'Application Support', 'claude-code-via-cursor', 'img');

	for (const msg of messages) {
		if (msg.messageType === 'userInput' && msg.data) {
			// Images can be in the message data directly or in an images array
			const images: Array<{ filePath?: string }> = [];
			if (Array.isArray(msg.data.images)) {
				images.push(...msg.data.images);
			}
			if (typeof msg.data === 'object' && msg.data.images) {
				images.push(...msg.data.images);
			}

			for (const img of images) {
				if (img.filePath && img.filePath.startsWith(imgDir)) {
					try {
						fs.unlinkSync(img.filePath);
						log.debug('Conversation', 'deleted image', { path: img.filePath }, '🧹');
					} catch {
						// File already gone
					}
				}
			}
		}
	}
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
		lastUserMessage: lastUserMessage.substring(0, 100)
	};

	conversationIndex = conversationIndex.filter(entry => entry.filename !== conversationData.filename);
	conversationIndex.unshift(indexEntry);

	if (conversationIndex.length > 50) {
		conversationIndex = conversationIndex.slice(0, 50);
		log.debug('Conversation', 'pruned conversation index to 50', undefined, '🧹');
	}

	deps?.workspaceState.update('claude.conversationIndex', conversationIndex);
	log.debug('Conversation', 'updateConversationIndex', { filename, indexCount: conversationIndex.length }, '📇');
}

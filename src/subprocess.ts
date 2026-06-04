import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as path from 'path';
import { log } from './logger';
import * as tokenCounters from './tokenCounters';
import * as conversation from './conversation';
import * as permissions from './permissions';
import * as backupRepo from './backupRepo';
import * as settings from './settings';
import * as terminalCommands from './terminalCommands';

const exec = util.promisify(cp.exec);

type PostMessageFn = (message: any) => void;

interface SubprocessDeps {
	postMessage: PostMessageFn;
	getStoragePath: () => string | undefined;
	getGlobalState: () => vscode.Memento;
}

let deps: SubprocessDeps | undefined;
let currentClaudeProcess: cp.ChildProcess | undefined;
let abortController: AbortController | undefined;
let isWslProcess: boolean = false;
let wslDistro: string = 'Ubuntu';
let isProcessing: boolean | undefined;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
const IMAGE_MEDIA_TYPES: Record<string, string> = {
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml'
};

const AUTH_PATTERNS: RegExp[] = [
	/not authenticated/i,
	/please (run )?[`"']?claude\s*\/?\s*login/i,
	/session (has |is )?expired/i,
	/authentication (failed|required|expired)/i,
	/\bunauthorized\b/i,
	/invalid (api )?key/i,
	/oauth.*(expired|invalid|failed|revoked)/i,
	/\b401\b/,
];

export function init(d: SubprocessDeps): void {
	log.info('Subprocess', 'init', { hasPostMessage: !!d.postMessage }, '🔧');
	deps = d;
}

let silentQueryCallback: ((text: string) => void) | null = null;
let userRequestedStop = false;

export function isActive(): boolean {
	return !!isProcessing;
}

export function isSilentQueryInFlight(): boolean {
	return silentQueryCallback !== null;
}

export function clearSilentQuery(): void {
	silentQueryCallback = null;
}

let pendingSilentQuery: { message: string; callback: (response: string) => void } | null = null;

export function sendSilentQuery(message: string, callback: (response: string) => void): void {
	if (!deps || !currentClaudeProcess?.stdin) {
		callback('');
		return;
	}
	if (isProcessing) {
		pendingSilentQuery = { message, callback };
		return;
	}
	silentQueryCallback = callback;
	const userMessage = {
		type: 'user',
		session_id: conversation.getCurrentSessionId() || '',
		message: { role: 'user', content: [{ type: 'text', text: message }] },
		parent_tool_use_id: null
	};
	currentClaudeProcess.stdin.write(JSON.stringify(userMessage) + '\n');
}

export function flushPendingSilentQuery(): void {
	if (pendingSilentQuery && currentClaudeProcess?.stdin && !isProcessing) {
		const { message, callback } = pendingSilentQuery;
		pendingSilentQuery = null;
		sendSilentQuery(message, callback);
	}
}

export function getProcess(): cp.ChildProcess | undefined {
	return currentClaudeProcess;
}

export function convertToWSLPath(windowsPath: string): string {
	log.debug('Subprocess', 'enter convertToWSLPath', { windowsPath }, '➡️');
	const config = vscode.workspace.getConfiguration('claudeCodeChat');
	const wslEnabled = config.get<boolean>('wsl.enabled', false);

	if (wslEnabled && windowsPath.match(/^[a-zA-Z]:/)) {
		const converted = windowsPath.replace(/^([a-zA-Z]):/, '/mnt/$1').toLowerCase().replace(/\\/g, '/');
		log.debug('Subprocess', 'exit convertToWSLPath — converted', { converted }, '⬅️');
		return converted;
	}

	log.debug('Subprocess', 'exit convertToWSLPath — unchanged', undefined, '⬅️');
	return windowsPath;
}

export async function sendMessage(message: string, planMode?: boolean, thinkingMode?: boolean, images?: Array<string | { filePath: string; previewUri?: string }>): Promise<void> {
	if (!deps) { return; }

	log.info('ClaudeProcess', 'sendMessage', {
		textLen: message?.length,
		text: message,
		planMode: !!planMode,
		thinkingMode: !!thinkingMode,
		imageCount: images?.length ?? 0,
		model: settings.getSelectedModel(),
		session: conversation.getCurrentSessionId(),
	}, '💬');
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : process.cwd();

	const configThink = vscode.workspace.getConfiguration('claudeCodeChat');
	const thinkingIntensity = configThink.get<string>('thinking.intensity', 'think');

	let actualMessage = message;
	if (thinkingMode) {
		let thinkingPrompt = '';
		const thinkingMesssage = ' THROUGH THIS STEP BY STEP: \n'
		switch (thinkingIntensity) {
			case 'think':
				thinkingPrompt = 'THINK';
				break;
			case 'think-hard':
				thinkingPrompt = 'THINK HARD';
				break;
			case 'think-harder':
				thinkingPrompt = 'THINK HARDER';
				break;
			case 'ultrathink':
				thinkingPrompt = 'ULTRATHINK';
				break;
			default:
				thinkingPrompt = 'THINK';
		}
		actualMessage = thinkingPrompt + thinkingMesssage + actualMessage;
	}

	isProcessing = true;

	const echoImages = (images || []).map(img =>
		typeof img === 'string' ? { filePath: img } : { filePath: img.filePath, previewUri: img.previewUri }
	);
	conversation.sendAndSaveMessage({
		type: 'userInput',
		data: message,
		images: echoImages.length > 0 ? echoImages : undefined
	});

	deps.postMessage({
		type: 'setProcessing',
		data: { isProcessing: true }
	});

	try {
		await backupRepo.createBackupCommit(message);
	}
	catch (e: any) {
		log.error('Subprocess', 'backupRepo.createBackupCommit failed', { error: e?.message ?? String(e) }, '💥');
	}

	deps.postMessage({
		type: 'loading',
		data: 'Claude is working...'
	});

	const args = [
		'--output-format', 'stream-json',
		'--input-format', 'stream-json',
		'--include-partial-messages',
		'--verbose'
	];

	const config = vscode.workspace.getConfiguration('claudeCodeChat');
	const yoloMode = config.get<boolean>('permissions.yoloMode', false);

	if (yoloMode) {
		args.push('--dangerously-skip-permissions');
	} else {
		args.push('--permission-prompt-tool', 'stdio');
	}

	const storagePath = deps.getStoragePath();
	const mcpConfigPath = storagePath ? path.join(storagePath, 'mcp', 'mcp-servers.json') : undefined;
	if (mcpConfigPath) {
		try {
			await vscode.workspace.fs.stat(vscode.Uri.file(mcpConfigPath));
			args.push('--mcp-config', convertToWSLPath(mcpConfigPath));
		} catch {
			// File doesn't exist, skip --mcp-config
		}
	}

	if (planMode) {
		args.push('--permission-mode', 'plan');
	}

	const claudeModels = ['opus', 'sonnet'];
	if (settings.getSelectedModel() && claudeModels.includes(settings.getSelectedModel())) {
		args.push('--model', settings.getSelectedModel());
	}

	const sessionId = conversation.getCurrentSessionId();
	if (sessionId) {
		args.push('--resume', sessionId);
	}

	const wslEnabled = config.get<boolean>('wsl.enabled', false);
	const wslDistroConfig = config.get<string>('wsl.distro', 'Ubuntu');
	const nodePath = config.get<string>('wsl.nodePath', '');
	const claudePath = config.get<string>('wsl.claudePath', '/usr/local/bin/claude');
	const customExecutablePath = config.get<string>('executable.path', '');
	const envsDisabled = config.get<boolean>('environment.disabled', false);
	const customEnvVars = envsDisabled ? {} : config.get<Record<string, string>>('environment.variables', {});

	let claudeProcess: cp.ChildProcess;

	abortController = new AbortController();

	let spawnEnv: NodeJS.ProcessEnv = {
		...process.env,
		FORCE_COLOR: '0',
		NO_COLOR: '1',
		...customEnvVars,
		CLAUDE_CODE_ENTRYPOINT: 'claude-vscode'
	};

	if (wslEnabled) {
		const wslEnvOverrides: Record<string, string> = { ...customEnvVars };
		wslEnvOverrides['CLAUDE_CODE_ENTRYPOINT'] = 'claude-vscode';
		const envExports = Object.entries(wslEnvOverrides)
			.map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
			.join(' && ');
		const envPrefix = envExports ? envExports + ' && ' : '';

		const wslCommand = envPrefix + terminalCommands.buildWslClaudeCommand(nodePath, claudePath, args);

		isWslProcess = true;
		wslDistro = wslDistroConfig;

		claudeProcess = cp.spawn('wsl', ['-d', wslDistroConfig, 'bash', '-ic', wslCommand], {
			signal: abortController.signal,
			detached: process.platform !== 'win32',
			cwd: cwd,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: spawnEnv
		});
	} else {
		isWslProcess = false;

		const executable = customExecutablePath || 'claude';
		claudeProcess = cp.spawn(executable, args, {
			signal: abortController.signal,
			shell: process.platform === 'win32' && !customExecutablePath,
			detached: process.platform !== 'win32',
			cwd: cwd,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: spawnEnv
		});
	}

	currentClaudeProcess = claudeProcess;

	if (claudeProcess.stdin) {
		const content: Array<{type: string; text?: string; source?: {type: string; media_type: string; data: string}}> = [];

		const imagePathRegex = /(\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|bmp))\b/gi;
		let lastIndex = 0;
		let match;
		while ((match = imagePathRegex.exec(actualMessage)) !== null) {
			const imagePath = match[1];
			const ext = path.extname(imagePath).toLowerCase();
			if (IMAGE_EXTENSIONS.includes(ext)) {
				try {
					const imageData = await vscode.workspace.fs.readFile(vscode.Uri.file(imagePath));
					const base64 = Buffer.from(imageData).toString('base64');
					const textBefore = actualMessage.substring(lastIndex, match.index);
					if (textBefore.trim()) {
						content.push({ type: 'text', text: textBefore.trim() });
					}
					content.push({
						type: 'image',
						source: {
							type: 'base64',
							media_type: IMAGE_MEDIA_TYPES[ext] || 'image/png',
							data: base64
						}
					});
					lastIndex = match.index + match[0].length;
				} catch (e: any) {
					log.error('Subprocess', 'could not read inline image', { imagePath, error: e?.message ?? String(e) }, '💥');
				}
			}
		}
		const remaining = actualMessage.substring(lastIndex);
		if (remaining.trim()) {
			content.push({ type: 'text', text: remaining.trim() });
		}

		if (images && images.length > 0) {
			for (const img of images) {
				const imagePath = typeof img === 'string' ? img : img.filePath;
				if (!imagePath) { continue; }
				const ext = IMAGE_EXTENSIONS.find(e => imagePath.toLowerCase().endsWith(e));
				if (ext) {
					try {
						const imageData = await vscode.workspace.fs.readFile(vscode.Uri.file(imagePath));
						const base64 = Buffer.from(imageData).toString('base64');
						content.push({
							type: 'image',
							source: {
								type: 'base64',
								media_type: IMAGE_MEDIA_TYPES[ext] || 'image/png',
								data: base64
							}
						});
					} catch (e: any) {
						log.error('Subprocess', 'could not read attached image', { imagePath, error: e?.message ?? String(e) }, '💥');
					}
				}
			}
		}

		if (content.length === 0) {
			content.push({ type: 'text', text: actualMessage });
		}

		const userMessage = {
			type: 'user',
			session_id: conversation.getCurrentSessionId() || '',
			message: {
				role: 'user',
				content: content
			},
			parent_tool_use_id: null
		};
		const userMessageJson = JSON.stringify(userMessage);
			claudeProcess.stdin.write(userMessageJson + '\n');
	}

	let rawOutput = '';
	let errorOutput = '';

	let authErrorFired = false;
	let lastStdoutMs = Date.now();
	let stallTimer: NodeJS.Timeout | undefined;
	let stallNotified = false;
	let stallKilled = false;
	const STALL_NOTIFY_MS = 30_000;
	const STALL_KILL_MS = 120_000;

	const fireAuthError = (rawSnippet: string) => {
		if (authErrorFired) { return; }
		authErrorFired = true;
		log.warn('AuthDetection', 'authError fired', { rawSnippet: rawSnippet.trim() }, '🔐');
		deps!.postMessage({
			type: 'authError',
			data: { rawError: rawSnippet.trim().slice(0, 800) }
		});
		try { claudeProcess.kill('SIGTERM'); } catch { /* already dead */ }
	};

	stallTimer = setInterval(() => {
		if (!currentClaudeProcess || authErrorFired || stallKilled) {
			if (stallTimer) { clearInterval(stallTimer); stallTimer = undefined; }
			return;
		}
		if (permissions.hasPending()) {
			lastStdoutMs = Date.now();
			if (stallNotified) {
				stallNotified = false;
				deps!.postMessage({ type: 'stallHintClear' });
			}
			return;
		}
		const silentFor = Date.now() - lastStdoutMs;
		if (!stallNotified && silentFor > STALL_NOTIFY_MS) {
			stallNotified = true;
			log.warn('StallWatchdog', 'stall notified', { silentFor }, '⏳');
			deps!.postMessage({
				type: 'processStalled',
				data: { sinceLastMs: silentFor }
			});
		}
		if (silentFor > STALL_KILL_MS) {
			stallKilled = true;
			log.error('StallWatchdog', 'stall killed', { silentFor, pid: claudeProcess.pid }, '☠️');
			deps!.postMessage({
				type: 'processKilled',
				data: { reason: 'inactivity', silentMs: silentFor }
			});
			try { claudeProcess.kill('SIGTERM'); } catch { /* already dead */ }
			setTimeout(() => {
				try { claudeProcess.kill('SIGKILL'); } catch { /* already dead */ }
			}, 2_000);
			if (stallTimer) { clearInterval(stallTimer); stallTimer = undefined; }
		}
	}, 5_000);

	if (claudeProcess.stdout) {
		claudeProcess.stdout.on('data', (data) => {
			lastStdoutMs = Date.now();
			rawOutput += data.toString();

			const lines = rawOutput.split('\n');
			rawOutput = lines.pop() || '';

			for (const line of lines) {
				if (line.trim()) {
					try {
						const jsonData = JSON.parse(line.trim());

						if (jsonData.type === 'control_request') {
							permissions.handleControlRequest(jsonData).catch((err: any) => {
								log.error('Subprocess', 'handleControlRequest failed', { error: err?.message ?? String(err) }, '💥');
							});
							continue;
						}

						if (jsonData.type === 'result') {
							if (claudeProcess.stdin && !claudeProcess.stdin.destroyed) {
								claudeProcess.stdin.end();
							}
						}

						processJsonStreamData(jsonData);
					} catch (error: any) {
						log.error('Subprocess', 'failed to parse JSON line', { line, error: error?.message ?? String(error) }, '💥');
					}
				}
			}
		});
	}

	if (claudeProcess.stderr) {
		claudeProcess.stderr.on('data', (data) => {
			const chunk = data.toString();
			errorOutput += chunk;
			if (!authErrorFired && AUTH_PATTERNS.some(p => p.test(chunk))) {
				fireAuthError(chunk);
			}
		});
	}

	claudeProcess.on('close', (code) => {
		if (stallTimer) { clearInterval(stallTimer); stallTimer = undefined; }

		if (!currentClaudeProcess) {
			return;
		}

		if (authErrorFired) {
			currentClaudeProcess = undefined;
			permissions.cancelPendingPermissionRequests();
			deps!.postMessage({ type: 'clearLoading' });
			isProcessing = false;
			deps!.postMessage({ type: 'setProcessing', data: { isProcessing: false } });
			return;
		}

		currentClaudeProcess = undefined;

		permissions.cancelPendingPermissionRequests();

		deps!.postMessage({
			type: 'clearLoading'
		});

		isProcessing = false;

		deps!.postMessage({
			type: 'setProcessing',
			data: { isProcessing: false }
		});

		if (code !== 0 && errorOutput.trim()) {
			if (errorOutput.includes('not recognized as an internal or external command')) {
				deps!.postMessage({
					type: 'showInstallModal',
					installAttempted: !!deps!.getGlobalState().get('installAttempted')
				});
			} else {
				conversation.sendAndSaveMessage({
					type: 'error',
					data: errorOutput.trim()
				});
			}
		}
	});

	claudeProcess.on('error', (error) => {
		log.error('Subprocess', 'claude process error', { error: error.message }, '💥');

		if (!currentClaudeProcess) {
			return;
		}

		currentClaudeProcess = undefined;

		permissions.cancelPendingPermissionRequests();

		deps!.postMessage({
			type: 'clearLoading'
		});

		isProcessing = false;

		deps!.postMessage({
			type: 'setProcessing',
			data: { isProcessing: false }
		});

		if (error.message.includes('ENOENT') || error.message.includes('command not found') || error.message.includes('not recognized as an internal or external command')) {
			deps!.postMessage({
				type: 'showInstallModal',
				installAttempted: !!deps!.getGlobalState().get('installAttempted')
			});
		} else if (userRequestedStop) {
			userRequestedStop = false;
		} else {
			conversation.sendAndSaveMessage({
				type: 'error',
				data: `Error running Claude: ${error.message}`
			});
		}
	});
}

async function processJsonStreamData(jsonData: any): Promise<void> {
	if (!deps) { return; }

	// Log only at meaningful transitions — skip the per-token content_block_delta
	// and the paired system/thinking_tokens since they fire dozens of times per
	// turn and add no actionable info. Anything genuinely useful (init, status,
	// content_block_start/stop, message_start/stop, result, errors) still logs.
	const evType = jsonData?.type;
	const evSub = jsonData?.subtype || jsonData?.event?.type;
	const isHighVolume =
		(evType === 'stream_event' && evSub === 'content_block_delta') ||
		(evType === 'system' && evSub === 'thinking_tokens');
	if (!isHighVolume) {
		log.debug('StreamParser', 'streamData', { type: evType, subtype: evSub }, '📡');
	}

	switch (jsonData.type) {
		case 'stream_event': {
			const ev = jsonData.event;
			if (!ev) { break; }
			if (ev.type === 'content_block_start' && ev.content_block) {
				const blockType = ev.content_block.type;
				log.debug('StreamParser', 'content_block_start', { blockType, index: ev.index }, '🧱');
				if (blockType === 'thinking') {
					log.info('StreamParser', 'thinkingBlockStart sent', undefined, '🧠');
					deps.postMessage({ type: 'thinkingBlockStart' });
				}
			} else if (ev.type === 'content_block_delta' && ev.delta) {
				const deltaType = ev.delta.type;
				if (deltaType === 'thinking_delta') {
					const chunk = ev.delta.thinking;
					if (typeof chunk === 'string' && chunk.length > 0) {
						log.debug('StreamParser', 'thinkingDelta sent', { chunkLen: chunk.length, chunkSnippet: chunk }, '🧠');
						deps.postMessage({ type: 'thinkingDelta', data: chunk });
					} else {
						log.warn('StreamParser', 'thinking_delta has empty chunk', { deltaKeys: Object.keys(ev.delta) }, '🤔');
					}
				} else if (deltaType && deltaType !== 'text_delta' && deltaType !== 'input_json_delta') {
					// Unknown delta types — surface so we notice if Anthropic adds a new one
					log.warn('StreamParser', 'unknown content_block_delta type', { deltaType, deltaKeys: Object.keys(ev.delta) }, '🤔');
				}
			}
			break;
		}

		case 'system':
			if (jsonData.subtype === 'init') {
				conversation.setCurrentSessionId(jsonData.session_id);

				conversation.sendAndSaveMessage({
					type: 'sessionInfo',
					data: {
						sessionId: jsonData.session_id,
						tools: jsonData.tools || [],
						mcpServers: jsonData.mcp_servers || []
					}
				});
			} else if (jsonData.subtype === 'status') {
				if (jsonData.status === 'compacting') {
					conversation.sendAndSaveMessage({
						type: 'compacting',
						data: { isCompacting: true }
					});
				} else if (jsonData.status === null) {
					conversation.sendAndSaveMessage({
						type: 'compacting',
						data: { isCompacting: false }
					});
				}
			} else if (jsonData.subtype === 'compact_boundary') {
				const { totalCost } = tokenCounters.getTotals();
				tokenCounters.setTotals(totalCost, 0, 0);

				conversation.sendAndSaveMessage({
					type: 'compactBoundary',
					data: {
						trigger: jsonData.compact_metadata?.trigger,
						preTokens: jsonData.compact_metadata?.pre_tokens
					}
				});
			}
			break;

		case 'assistant':
			if (jsonData.message && jsonData.message.content) {
				if (jsonData.message.model) {
					deps.postMessage({ type: 'modelResolved', model: jsonData.message.model });
				}
				if (jsonData.message.usage) {
					tokenCounters.addTokens(
						jsonData.message.usage.input_tokens || 0,
						jsonData.message.usage.output_tokens || 0
					);
					const totals = tokenCounters.getTotals();

					conversation.sendAndSaveMessage({
						type: 'updateTokens',
						data: {
							totalTokensInput: totals.totalTokensInput,
							totalTokensOutput: totals.totalTokensOutput,
							currentInputTokens: jsonData.message.usage.input_tokens || 0,
							currentOutputTokens: jsonData.message.usage.output_tokens || 0,
							cacheCreationTokens: jsonData.message.usage.cache_creation_input_tokens || 0,
							cacheReadTokens: jsonData.message.usage.cache_read_input_tokens || 0
						}
					});
				}

				for (const content of jsonData.message.content) {
					if (content.type === 'text' && content.text.trim()) {
						if (silentQueryCallback) {
							silentQueryCallback(content.text.trim());
							silentQueryCallback = null;
							continue;
						}
						conversation.sendAndSaveMessage({
							type: 'output',
							data: content.text.trim()
						});
					} else if (content.type === 'thinking' && content.thinking.trim()) {
						conversation.sendAndSaveMessage({
							type: 'thinking',
							data: content.thinking.trim()
						});
					} else if (content.type === 'tool_use') {
						const toolInfo = `🔧 Executing: ${content.name}`;
						let toolInput = '';
						let fileContentBefore: string | undefined;

						if (content.input) {
							if (content.name === 'TodoWrite' && content.input.todos) {
								toolInput = '\nTodo List Update:';
								for (const todo of content.input.todos) {
									const status = todo.status === 'completed' ? '✅' :
										todo.status === 'in_progress' ? '🔄' : '⏳';
									toolInput += `\n${status} ${todo.content} (priority: ${todo.priority})`;
								}
							} else {
								toolInput = '';
							}

							if ((content.name === 'Edit' || content.name === 'MultiEdit' || content.name === 'Write') && content.input.file_path) {
								try {
									const fileUri = vscode.Uri.file(content.input.file_path);
									const fileData = await vscode.workspace.fs.readFile(fileUri);
									fileContentBefore = Buffer.from(fileData).toString('utf8');
								} catch {
									fileContentBefore = '';
								}
							}
						}

						let startLine: number | undefined;
						let startLines: number[] | undefined;
						if (fileContentBefore !== undefined) {
							if (content.name === 'Edit' && content.input.old_string) {
								const position = fileContentBefore.indexOf(content.input.old_string);
								if (position !== -1) {
									const textBefore = fileContentBefore.substring(0, position);
									startLine = (textBefore.match(/\n/g) || []).length + 1;
								} else {
									startLine = 1;
								}
							} else if (content.name === 'MultiEdit' && content.input.edits) {
								startLines = content.input.edits.map((edit: any) => {
									if (edit.old_string) {
										const position = fileContentBefore!.indexOf(edit.old_string);
										if (position !== -1) {
											const textBefore = fileContentBefore!.substring(0, position);
											return (textBefore.match(/\n/g) || []).length + 1;
										}
									}
									return 1;
								});
							}
						}

						conversation.sendAndSaveMessage({
							type: 'toolUse',
							data: {
								toolInfo: toolInfo,
								toolInput: toolInput,
								rawInput: content.input,
								toolName: content.name,
								fileContentBefore: fileContentBefore,
								startLine: startLine,
								startLines: startLines
							}
						});
					}
				}
			}
			break;

		case 'user':
			if (jsonData.message && jsonData.message.content) {
				for (const content of jsonData.message.content) {
					if (content.type === 'tool_result') {
						let resultContent = content.content || 'Tool executed successfully';

						if (typeof resultContent === 'object' && resultContent !== null) {
							resultContent = JSON.stringify(resultContent, null, 2);
						}

						const isError = content.is_error || false;

						const lastToolUse = conversation.getCurrentConversation()[conversation.getCurrentConversation().length - 1]

						const toolName = lastToolUse?.data?.toolName;
						const rawInput = lastToolUse?.data?.rawInput;
						const startLine = lastToolUse?.data?.startLine;
						const startLines = lastToolUse?.data?.startLines;

						let fileContentAfter: string | undefined;
						if ((toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write') && rawInput?.file_path && !isError) {
							try {
								const fileUri = vscode.Uri.file(rawInput.file_path);
								const fileData = await vscode.workspace.fs.readFile(fileUri);
								fileContentAfter = Buffer.from(fileData).toString('utf8');
							} catch {
								// File read failed, that's ok
							}
						}

						if ((toolName === 'Read' || toolName === 'TodoWrite') && !isError) {
							conversation.sendAndSaveMessage({
								type: 'toolResult',
								data: {
									content: resultContent,
									isError: isError,
									toolUseId: content.tool_use_id,
									toolName: toolName,
									rawInput: rawInput,
									hidden: true
								}
							});
						} else {
							conversation.sendAndSaveMessage({
								type: 'toolResult',
								data: {
									content: resultContent,
									isError: isError,
									toolUseId: content.tool_use_id,
									toolName: toolName,
									rawInput: rawInput,
									fileContentAfter: fileContentAfter,
									startLine: startLine,
									startLines: startLines
								}
							});
						}
					}
				}
			}
			break;

		case 'result':
			if (jsonData.subtype === 'success') {
				if (jsonData.is_error && jsonData.result && (
					jsonData.result.includes('Invalid API key') ||
					jsonData.result.includes('Not logged in') ||
					jsonData.result.includes('/login') ||
					jsonData.result.includes('not authenticated')
				)) {
					handleLoginRequired();
					return;
				}

				isProcessing = false;

				if (jsonData.session_id) {
					conversation.setCurrentSessionId(jsonData.session_id);

					conversation.sendAndSaveMessage({
						type: 'sessionInfo',
						data: {
							sessionId: jsonData.session_id,
							tools: jsonData.tools || [],
							mcpServers: jsonData.mcp_servers || []
						}
					});
				}

				deps.postMessage({
					type: 'setProcessing',
					data: { isProcessing: false }
				});

				tokenCounters.addRequest();
				if (jsonData.total_cost_usd) {
					tokenCounters.addTokens(0, 0, jsonData.total_cost_usd);
				}

				try {
					const globalState = deps.getGlobalState();
					const prev = globalState.get<number>('lifetimeMessageSuccessCount', 0) || 0;
					const next = prev + 1;
					globalState.update('lifetimeMessageSuccessCount', next);
					if (next === 1 || next === 50 || (next > 50 && next % 100 === 0)) {
						deps.postMessage({ type: 'messageMilestone', count: next });
					}
				} catch {
					// best-effort
				}

				const resultTotals = tokenCounters.getTotals();
				deps.postMessage({
					type: 'updateTotals',
					data: {
						totalCost: resultTotals.totalCost,
						totalTokensInput: resultTotals.totalTokensInput,
						totalTokensOutput: resultTotals.totalTokensOutput,
						requestCount: resultTotals.requestCount,
						currentCost: jsonData.total_cost_usd,
						currentDuration: jsonData.duration_ms,
						currentTurns: jsonData.num_turns
					}
				});

			}
			break;
	}
}

function handleLoginRequired(): void {
	log.warn('Subprocess', 'handleLoginRequired', undefined, '🔐');
	if (!deps) { return; }

	isProcessing = false;

	deps.postMessage({
		type: 'setProcessing',
		data: { isProcessing: false }
	});

	terminalCommands.openLoginTerminal();
	deps.postMessage({
		type: 'loginRequired'
	});
}

async function killProcessGroup(pid: number, signal: string = 'SIGTERM'): Promise<void> {
	log.debug('Subprocess', 'enter killProcessGroup', { pid, signal, isWslProcess }, '➡️');
	if (isWslProcess) {
		try {
			const killSignal = signal === 'SIGKILL' ? '-9' : '-15';
			await exec(`wsl -d ${wslDistro} pkill ${killSignal} -f "claude"`);
		} catch {
			// Process may already be dead or pkill not available
		}
		try {
			await exec(`taskkill /pid ${pid} /t /f`);
		} catch {
			// Process may already be dead
		}
	} else if (process.platform === 'win32') {
		try {
			await exec(`taskkill /pid ${pid} /t /f`);
		} catch {
			// Process may already be dead
		}
	} else {
		try {
			process.kill(-pid, signal as NodeJS.Signals);
		} catch {
			// Process may already be dead
		}
	}
}

export async function killProcess(): Promise<void> {
	const processToKill = currentClaudeProcess;
	const pid = processToKill?.pid;
	log.info('ClaudeProcess', 'killClaudeProcess', { pid }, '💀');

	abortController?.abort();
	abortController = undefined;

	currentClaudeProcess = undefined;

	if (!pid) {
		return;
	}

	await killProcessGroup(pid, 'SIGTERM');

	const exitPromise = new Promise<void>((resolve) => {
		if (processToKill?.killed) {
			resolve();
			return;
		}
		processToKill?.once('exit', () => resolve());
	});

	const timeoutPromise = new Promise<void>((resolve) => {
		setTimeout(() => resolve(), 2000);
	});

	await Promise.race([exitPromise, timeoutPromise]);

	if (processToKill && !processToKill.killed) {
		await killProcessGroup(pid, 'SIGKILL');
	}
}

export async function stopProcess(): Promise<void> {
	log.info('Subprocess', 'enter stopProcess', undefined, '➡️');
	if (!deps) { return; }

	userRequestedStop = true;
	isProcessing = false;

	deps.postMessage({
		type: 'setProcessing',
		data: { isProcessing: false }
	});

	await killProcess();

	deps.postMessage({
		type: 'clearLoading'
	});

	conversation.sendAndSaveMessage({
		type: 'notice',
		data: { title: 'Stopped', content: 'Request cancelled by user.', variant: 'warning' }
	});
}

export function forceShutdown(): void {
	const pid = currentClaudeProcess?.pid;
	log.info('ClaudeProcess', 'forceShutdown', { pid }, '🛑');
	try { abortController?.abort(); } catch { /* ignore */ }
	abortController = undefined;
	currentClaudeProcess = undefined;
	if (typeof pid === 'number' && pid > 0) {
		try {
			if (process.platform === 'win32') {
				process.kill(pid, 'SIGTERM');
			} else {
				try { process.kill(-pid, 'SIGTERM'); } catch { process.kill(pid, 'SIGTERM'); }
			}
		} catch { /* already dead */ }
	}
}

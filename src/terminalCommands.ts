import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { downloadClaude, detectPlatform, DownloaderError } from './claudeDownloader';
import { log } from './logger';

type PostMessageFn = (message: any) => void;
type SendMessageFn = (text: string) => void;

function quoteBashArg(value: string): string {
	return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildWslClaudeCommand(nodePath: string, claudePath: string, args: string[] = []): string {
	log.debug('Terminals', 'enter buildWslClaudeCommand', { nodePath, claudePath, argCount: args.length }, '➡️');
	const trimmedNodePath = nodePath.trim();
	const commandParts = trimmedNodePath
		? [quoteBashArg(trimmedNodePath), '--no-warnings', '--enable-source-maps', quoteBashArg(claudePath)]
		: [quoteBashArg(claudePath)];
	const quotedArgs = args.map(arg => quoteBashArg(arg));
	const result = [...commandParts, ...quotedArgs].join(' ');
	log.debug('Terminals', 'exit buildWslClaudeCommand', { result }, '⬅️');
	return result;
}

export function buildClaudeTerminalOptions(args: string[] = []): { shellPath: string; shellArgs: string[] } {
	log.debug('Terminals', 'enter buildClaudeTerminalOptions', { args }, '➡️');
	const config = vscode.workspace.getConfiguration('ccvi');
	const wslEnabled = config.get<boolean>('wsl.enabled', false);

	if (wslEnabled) {
		log.debug('Terminals', 'WSL mode enabled', undefined, '🔀');
		const wslDistro = config.get<string>('wsl.distro', 'Ubuntu');
		const nodePath = config.get<string>('wsl.nodePath', '');
		const claudePath = config.get<string>('wsl.claudePath', '/usr/local/bin/claude');
		const wslCommand = buildWslClaudeCommand(nodePath, claudePath, args);
		const result = {
			shellPath: process.platform === 'win32' ? 'wsl.exe' : 'wsl',
			shellArgs: ['-d', wslDistro, 'bash', '-ic', wslCommand]
		};
		log.debug('Terminals', 'exit buildClaudeTerminalOptions (WSL)', { shellPath: result.shellPath, distro: wslDistro }, '⬅️');
		return result;
	}

	const custom = (config.get<string>('executable.path', '') || '').trim();
	const result = {
		shellPath: custom || 'claude',
		shellArgs: args
	};
	log.debug('Terminals', 'exit buildClaudeTerminalOptions', { shellPath: result.shellPath }, '⬅️');
	return result;
}

export function runTerminalCommand(command: string): void {
	log.debug('Terminals', 'enter runTerminalCommand', { command }, '➡️');
	const terminal = vscode.window.createTerminal({
		name: 'Claude Code',
		location: vscode.TerminalLocation.Editor
	});
	terminal.show();
	terminal.sendText(command);
	log.debug('Terminals', 'exit runTerminalCommand', undefined, '⬅️');
}

export function openModelTerminal(currentSessionId: string | undefined, postMessage: PostMessageFn): void {
	log.debug('Terminals', 'enter openModelTerminal', { currentSessionId }, '➡️');
	const args = ['/model'];
	if (currentSessionId) {
		args.push('--resume', currentSessionId);
	}

	const terminal = vscode.window.createTerminal({
		name: 'Claude Model Selection',
		location: { viewColumn: vscode.ViewColumn.One },
		...buildClaudeTerminalOptions(args)
	});
	terminal.show();

	vscode.window.showInformationMessage(
		'Check the terminal to update your default model configuration. Come back to this chat here after making changes.',
		'OK'
	);

	postMessage({
		type: 'terminalOpened',
		data: 'Check the terminal to update your default model configuration. Come back to this chat here after making changes.'
	});
	log.debug('Terminals', 'exit openModelTerminal', undefined, '⬅️');
}

export function openUsageTerminal(): void {
	log.debug('Terminals', 'enter openUsageTerminal', undefined, '➡️');
	const terminal = vscode.window.createTerminal({
		name: 'Claude Usage',
		location: { viewColumn: vscode.ViewColumn.One },
		...buildClaudeTerminalOptions(['/usage'])
	});
	terminal.show();
	log.debug('Terminals', 'exit openUsageTerminal', undefined, '⬅️');
}

export function openLoginTerminal(): void {
	log.debug('Terminals', 'enter openLoginTerminal', undefined, '➡️');
	const terminal = vscode.window.createTerminal({
		name: 'Claude Login',
		location: { viewColumn: vscode.ViewColumn.One },
		...buildClaudeTerminalOptions()
	});
	terminal.show();
	log.debug('Terminals', 'exit openLoginTerminal', undefined, '⬅️');
}

export function executeSlashCommand(command: string, currentSessionId: string | undefined, postMessage: PostMessageFn, sendMessage: SendMessageFn): void {
	log.debug('Terminals', 'enter executeSlashCommand', { command, currentSessionId }, '➡️');
	if (command === 'compact') {
		log.debug('Terminals', 'compact command — sending inline', undefined, '🔀');
		sendMessage(`/${command}`);
		return;
	}

	const args = [`/${command}`];
	if (currentSessionId) {
		args.push('--resume', currentSessionId);
	}

	const terminal = vscode.window.createTerminal({
		name: `Claude /${command}`,
		location: { viewColumn: vscode.ViewColumn.One },
		...buildClaudeTerminalOptions(args)
	});
	terminal.show();

	vscode.window.showInformationMessage(
		`Executing /${command} command in terminal. Check the terminal output and return when ready.`,
		'OK'
	);

	postMessage({
		type: 'terminalOpened',
		data: `Executing /${command} command in terminal. Check the terminal output and return when ready.`,
	});
	log.debug('Terminals', 'exit executeSlashCommand', { command }, '⬅️');
}

export async function enableYoloMode(postMessage: PostMessageFn, sendCurrentSettings: () => void): Promise<void> {
	log.debug('Terminals', 'enter enableYoloMode', undefined, '➡️');
	try {
		const config = vscode.workspace.getConfiguration('ccvi');
		await config.update('permissions.yoloMode', true, vscode.ConfigurationTarget.Workspace);
		sendCurrentSettings();
		log.debug('Terminals', 'exit enableYoloMode — enabled', undefined, '⬅️');
	} catch (error: any) {
		log.error('Terminals', 'enableYoloMode failed', { error: error?.message ?? String(error) }, '💥');
	}
}

export async function runInstallCommand(
	method: string,
	globalStoragePath: string,
	postMessage: PostMessageFn,
	globalState: vscode.Memento
): Promise<void> {
	log.info('Terminals', 'enter runInstallCommand', { method, globalStoragePath }, '➡️');
	globalState.update('installAttempted', true);

	const config = vscode.workspace.getConfiguration('ccvi');
	const wslEnabled = config.get<boolean>('wsl.enabled', false);
	const platform = process.platform;
	const arch = os.arch();

	if (wslEnabled) {
		log.warn('Terminals', 'install not supported in WSL mode', undefined, '🚫');
		postMessage({
			type: 'installComplete',
			success: false,
			method,
			error: 'WSL mode: please install Claude inside your WSL distro, then set ccvi.wsl.claudePath.',
			errorCode: 'WSL_NOT_SUPPORTED',
			platform,
			arch
		});
		return;
	}

	if (!detectPlatform()) {
		log.warn('Terminals', 'unsupported platform for install', { platform, arch }, '🚫');
		postMessage({
			type: 'installComplete',
			success: false,
			method,
			error: `Unsupported platform: ${platform}/${arch}. Install Claude manually from https://code.claude.com.`,
			errorCode: 'UNSUPPORTED_PLATFORM',
			platform,
			arch
		});
		return;
	}

	const destDir = path.join(globalStoragePath, 'bin');

	try {
		const result = await downloadClaude({
			destDir,
			onProgress: (p) => postMessage({ type: 'installProgress', ...p })
		});

		const existing = (config.get<string>('executable.path', '') || '').trim();
		if (!existing) {
			try {
				await config.update('executable.path', result.binaryPath, vscode.ConfigurationTarget.Global);
			} catch {
				// fall through
			}
		}

		log.info('Terminals', 'install succeeded', { source: result.source, version: result.version, binaryPath: result.binaryPath }, '✅');
		postMessage({
			type: 'installComplete',
			success: true,
			method,
			configuredPath: existing ? undefined : result.binaryPath,
			existingPathRespected: !!existing,
			source: result.source,
			version: result.version,
			platform,
			arch
		});
	} catch (err) {
		const d = err instanceof DownloaderError ? err : null;
		const details = d?.details;
		log.error('Terminals', 'install failed', { error: d?.message ?? String(err), errorCode: d?.code }, '💥');
		postMessage({
			type: 'installComplete',
			success: false,
			method,
			error: d?.message || 'Installation failed. Please try again.',
			errorCode: d?.code,
			npmCode: typeof details?.npmCode === 'string' ? details.npmCode : undefined,
			cdnCode: typeof details?.cdnCode === 'string' ? details.cdnCode : undefined,
			platform,
			arch
		});
	}
}

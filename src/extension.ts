import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { initLogger, log } from './logger';
import * as profile from './profile';
import * as settings from './settings';
import * as backupRepo from './backupRepo';
import * as conversation from './conversation';
import * as permissions from './permissions';
import * as skillsAndPlugins from './skillsAndPlugins';
import * as subprocess from './subprocess';
import * as webview from './webview';

class DiffContentProvider implements vscode.TextDocumentContentProvider {
	provideTextDocumentContent(uri: vscode.Uri): string {
		const content = webview.getDiffContentStore().get(uri.path);
		return content || '';
	}
}

export function activate(context: vscode.ExtensionContext) {
	const version = context.extension?.packageJSON?.version ?? '(unknown)';
	const mode = vscode.ExtensionMode[context.extensionMode];
	initLogger({ version, mode });
	log.info('Extension', 'activate', { version, mode }, '🚀');

	// Initialize all modules
	webview.init({
		extensionUri: context.extensionUri,
		getStoragePath: () => context.storageUri?.fsPath,
		getGlobalState: () => context.globalState,
		getGlobalStoragePath: () => context.globalStorageUri.fsPath,
		getPackageVersion: () => context.extension?.packageJSON?.version
	});
	profile.init({ postMessage: (msg: any) => webview.postMessage(msg) });
	settings.init({
		postMessage: (msg: any) => webview.postMessage(msg),
		workspaceState: context.workspaceState,
		globalState: context.globalState
	});
	backupRepo.init({
		postMessage: (msg) => webview.postMessage(msg),
		sendAndSaveMessage: (msg) => conversation.sendAndSaveMessage(msg),
		storagePath: context.storageUri?.fsPath
	});
	backupRepo.initializeBackupRepo();
	conversation.init({
		postMessage: (msg) => webview.postMessage(msg),
		workspaceState: context.workspaceState
	});
	conversation.initializeConversations(context.storageUri?.fsPath);
	skillsAndPlugins.init({
		postMessage: (msg) => webview.postMessage(msg),
		storagePath: context.storageUri?.fsPath
	});
	permissions.init({
		postMessage: (msg) => webview.postMessage(msg),
		writeToStdin: (data) => {
			const proc = subprocess.getProcess();
			if (proc?.stdin && !proc.stdin.destroyed) {
				return proc.stdin.write(data);
			}
			return false;
		},
		getStdinAvailable: () => {
			const proc = subprocess.getProcess();
			return !!(proc?.stdin && !proc.stdin.destroyed);
		},
		storagePath: context.storageUri?.fsPath
	});
	subprocess.init({
		postMessage: (msg) => webview.postMessage(msg),
		getStoragePath: () => context.storageUri?.fsPath,
		getGlobalState: () => context.globalState
	});

	const latestConversation = conversation.getLatestConversation();
	conversation.setCurrentSessionId(latestConversation?.sessionId);

	// Register commands
	const disposable = vscode.commands.registerCommand('claude-code-via-cursor.openChat', (column?: vscode.ViewColumn) => {
		webview.show(column);
	});

	const loadConversationDisposable = vscode.commands.registerCommand('claude-code-via-cursor.loadConversation', (filename: string) => {
		webview.loadConversation(filename);
	});

	// Register webview view provider for sidebar chat
	const webviewProvider = new webview.ClaudeChatWebviewProvider(context.extensionUri);
	vscode.window.registerWebviewViewProvider('claude-code-via-cursor.chat', webviewProvider);

	// Register custom content provider for read-only diff views
	const diffProvider = new DiffContentProvider();
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('claude-diff', diffProvider));

	// Listen for configuration changes
	const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('claudeCodeChat.wsl')) {
			webview.newSessionOnConfigChange();
		}
	});

	// Create status bar item
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.text = "Claude";
	statusBarItem.tooltip = "Open Claude Code Chat (Ctrl+Shift+C)";
	statusBarItem.command = 'claude-code-via-cursor.openChat';
	statusBarItem.show();

	// Profile watcher
	const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
	const push = () => profile.readAndPushProfile();
	push();
	const profileWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(vscode.Uri.file(path.dirname(settingsPath)), 'settings.json')
	);
	profileWatcher.onDidChange(push);
	profileWatcher.onDidCreate(push);
	profileWatcher.onDidDelete(push);

	// Register URI handler for deep links (reserved for future use)
	const uriHandler = vscode.window.registerUriHandler({
		async handleUri(_uri: vscode.Uri) {
		}
	});

	context.subscriptions.push(disposable, loadConversationDisposable, configChangeDisposable, statusBarItem, uriHandler, profileWatcher);
}

export function deactivate() {
	log.info('Extension', 'deactivate', undefined, '🛑');
	try {
		webview.forceShutdown();
	} catch (e: any) {
		log.error('Extension', 'forceShutdown failed', { error: e?.message ?? String(e) }, '💥');
	}
}

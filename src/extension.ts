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
import * as sessionLock from './sessionLock';
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

	// Cross-window single-writer lock (per session id). Uses the global storage
	// path so the lock is shared across windows of the same workspace.
	sessionLock.init(context.globalStorageUri.fsPath);

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

	// Profile + settings watcher. Pushes the identity profile to the UI AND
	// requests a graceful subprocess restart at the next idle boundary so a
	// profile/provider swap (env block in settings.json) takes effect — model-
	// within-provider is handled in-band by set_model, but provider/account/
	// region are read at process startup and need a respawn.
	const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
	const onSettingsChange = () => {
		profile.readAndPushProfile();
		subprocess.requestSettingsRestart();
	};
	profile.readAndPushProfile();
	const profileWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(vscode.Uri.file(path.dirname(settingsPath)), 'settings.json')
	);
	profileWatcher.onDidChange(onSettingsChange);
	profileWatcher.onDidCreate(onSettingsChange);
	profileWatcher.onDidDelete(onSettingsChange);

	// Also watch the project-level CLI settings the extension manages, since the
	// model / env there also affects the next spawn.
	let localSettingsWatcher: vscode.FileSystemWatcher | undefined;
	const wsFolder = vscode.workspace.workspaceFolders?.[0];
	if (wsFolder) {
		localSettingsWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(wsFolder, '.claude/settings.local.json')
		);
		localSettingsWatcher.onDidChange(() => subprocess.requestSettingsRestart());
		localSettingsWatcher.onDidCreate(() => subprocess.requestSettingsRestart());
		localSettingsWatcher.onDidDelete(() => subprocess.requestSettingsRestart());
	}

	// Register URI handler for deep links (reserved for future use)
	const uriHandler = vscode.window.registerUriHandler({
		async handleUri(_uri: vscode.Uri) {
		}
	});

	context.subscriptions.push(disposable, loadConversationDisposable, configChangeDisposable, statusBarItem, uriHandler, profileWatcher);
	if (localSettingsWatcher) { context.subscriptions.push(localSettingsWatcher); }
}

export function deactivate() {
	log.info('Extension', 'deactivate', undefined, '🛑');
	try {
		// Park the active session to history (parity with Skull) before tearing
		// down the process, so a reload/close leaves a resumable index entry.
		// Best-effort: deactivate can't reliably await, but saving also happens
		// per-message, so this is the final flush.
		void conversation.parkToHistory();
	} catch (e: any) {
		log.error('Extension', 'parkToHistory on deactivate failed', { error: e?.message ?? String(e) }, '💥');
	}
	try {
		webview.forceShutdown();
	} catch (e: any) {
		log.error('Extension', 'forceShutdown failed', { error: e?.message ?? String(e) }, '💥');
	}
}

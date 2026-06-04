import * as vscode from 'vscode';
import * as path from 'path';
import * as util from 'util';
import * as cp from 'child_process';
import { log } from './logger';

const exec = util.promisify(cp.exec);

type PostMessageFn = (message: any) => void;
type SendAndSaveFn = (message: any) => void;

interface BackupRepoDeps {
	postMessage: PostMessageFn;
	sendAndSaveMessage: SendAndSaveFn;
	storagePath: string | undefined;
}

let deps: BackupRepoDeps | undefined;
let backupRepoPath: string | undefined;
let commits: Array<{ id: string; sha: string; message: string; timestamp: string }> = [];

export function init(d: BackupRepoDeps): void {
	log.info('BackupRepo', 'init', { hasPostMessage: !!d.postMessage, hasStoragePath: !!d.storagePath }, '🔧');
	deps = d;
}

export function getCommits(): typeof commits {
	return commits;
}

export function resetCommits(): void {
	log.debug('BackupRepo', 'resetCommits', { previousCount: commits.length }, '🧹');
	commits = [];
}

export async function initializeBackupRepo(): Promise<void> {
	log.debug('BackupRepo', 'enter initializeBackupRepo', undefined, '➡️');
	try {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			log.debug('BackupRepo', 'no workspace folder, skipping', undefined, '🚫');
			return;
		}

		const storagePath = deps?.storagePath;
		if (!storagePath) {
			log.error('BackupRepo', 'no workspace storage available', undefined, '💥');
			return;
		}
		backupRepoPath = path.join(storagePath, 'backups', '.git');

		try {
			await vscode.workspace.fs.stat(vscode.Uri.file(backupRepoPath));
			log.debug('BackupRepo', 'backup repo already exists', { backupRepoPath }, '✅');
		} catch {
			log.debug('BackupRepo', 'creating new backup repo', { backupRepoPath }, '🧱');
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(backupRepoPath));

			const workspacePath = workspaceFolder.uri.fsPath;

			await exec(`git --git-dir="${backupRepoPath}" --work-tree="${workspacePath}" init`);
			await exec(`git --git-dir="${backupRepoPath}" config user.name "Claude Code Chat"`);
			await exec(`git --git-dir="${backupRepoPath}" config user.email "claude@anthropic.com"`);
			log.info('BackupRepo', 'backup repo initialized', { backupRepoPath, workspacePath }, '✅');
		}
		log.debug('BackupRepo', 'exit initializeBackupRepo', { backupRepoPath }, '⬅️');
	} catch (error: any) {
		log.error('BackupRepo', 'initializeBackupRepo failed', { error: error?.message ?? String(error) }, '💥');
	}
}

export async function createBackupCommit(userMessage: string): Promise<void> {
	log.debug('BackupRepo', 'enter createBackupCommit', { userMessageLen: userMessage.length }, '➡️');
	try {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder || !backupRepoPath) {
			log.debug('BackupRepo', 'no workspace or backup repo, skipping', { hasWorkspace: !!workspaceFolder, hasBackupRepo: !!backupRepoPath }, '🚫');
			return;
		}

		const workspacePath = workspaceFolder.uri.fsPath;
		const now = new Date();
		const timestamp = now.toISOString().replace(/[:.]/g, '-');
		const displayTimestamp = now.toISOString();
		const commitMessage = `Before: ${userMessage.substring(0, 50)}${userMessage.length > 50 ? '...' : ''}`;

		await exec(`git --git-dir="${backupRepoPath}" --work-tree="${workspacePath}" add -A`);

		let isFirstCommit = false;
		try {
			await exec(`git --git-dir="${backupRepoPath}" rev-parse HEAD`);
		} catch {
			isFirstCommit = true;
		}

		const { stdout: status } = await exec(`git --git-dir="${backupRepoPath}" --work-tree="${workspacePath}" status --porcelain`);

		let actualMessage;
		if (isFirstCommit) {
			actualMessage = `Initial backup: ${userMessage.substring(0, 50)}${userMessage.length > 50 ? '...' : ''}`;
			log.debug('BackupRepo', 'first commit', undefined, '🔀');
		} else if (status.trim()) {
			actualMessage = commitMessage;
			log.debug('BackupRepo', 'changes detected', { statusLen: status.trim().length }, '🔀');
		} else {
			actualMessage = `Checkpoint (no changes): ${userMessage.substring(0, 50)}${userMessage.length > 50 ? '...' : ''}`;
			log.debug('BackupRepo', 'no changes, checkpoint commit', undefined, '🔀');
		}

		await exec(`git --git-dir="${backupRepoPath}" --work-tree="${workspacePath}" commit --allow-empty -m "${actualMessage}"`);
		const { stdout: sha } = await exec(`git --git-dir="${backupRepoPath}" rev-parse HEAD`);

		const commitInfo = {
			id: `commit-${timestamp}`,
			sha: sha.trim(),
			message: actualMessage,
			timestamp: displayTimestamp
		};

		commits.push(commitInfo);

		deps?.sendAndSaveMessage({
			type: 'showRestoreOption',
			data: commitInfo
		});

		log.info('BackupRepo', 'backup commit created', { sha: sha.trim(), message: actualMessage }, '💾');

	} catch (error: any) {
		log.error('BackupRepo', 'createBackupCommit failed', { error: error?.message ?? String(error) }, '💥');
	}
}

export async function restoreToCommit(commitSha: string): Promise<void> {
	log.debug('BackupRepo', 'enter restoreToCommit', { commitSha }, '➡️');
	try {
		const commit = commits.find(c => c.sha === commitSha);
		if (!commit) {
			log.warn('BackupRepo', 'commit not found', { commitSha }, '🚫');
			deps?.postMessage({
				type: 'restoreError',
				data: 'Commit not found'
			});
			return;
		}

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder || !backupRepoPath) {
			log.warn('BackupRepo', 'no workspace or backup repo for restore', undefined, '🚫');
			vscode.window.showErrorMessage('No workspace folder or backup repository available.');
			return;
		}

		const workspacePath = workspaceFolder.uri.fsPath;

		deps?.postMessage({
			type: 'restoreProgress',
			data: 'Restoring files from backup...'
		});

		await exec(`git --git-dir="${backupRepoPath}" --work-tree="${workspacePath}" checkout ${commitSha} -- .`);

		vscode.window.showInformationMessage(`Restored to commit: ${commit.message}`);

		deps?.sendAndSaveMessage({
			type: 'restoreSuccess',
			data: {
				message: `Successfully restored to: ${commit.message}`,
				commitSha: commitSha
			}
		});

		log.info('BackupRepo', 'restore successful', { commitSha, message: commit.message }, '✅');

	} catch (error: any) {
		log.error('BackupRepo', 'restoreToCommit failed', { commitSha, error: error?.message ?? String(error) }, '💥');
		vscode.window.showErrorMessage(`Failed to restore commit: ${error.message}`);
		deps?.postMessage({
			type: 'restoreError',
			data: `Failed to restore: ${error.message}`
		});
	}
}

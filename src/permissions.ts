import * as vscode from 'vscode';
import * as path from 'path';
import * as conversation from './conversation';
import { log } from './logger';

type PostMessageFn = (message: any) => void;
type WriteToStdinFn = (data: string) => boolean;
type GetStdinAvailableFn = () => boolean;

interface PermissionsDeps {
	postMessage: PostMessageFn;
	writeToStdin: WriteToStdinFn;
	getStdinAvailable: GetStdinAvailableFn;
	storagePath: string | undefined;
}

interface PendingRequest {
	requestId: string;
	toolName: string;
	input: Record<string, unknown>;
	suggestions?: any[];
	toolUseId: string;
}

let deps: PermissionsDeps | undefined;
let pendingPermissionRequests: Map<string, PendingRequest> = new Map();

export function init(d: PermissionsDeps): void {
	log.info('Permissions', 'init', { hasPostMessage: !!d.postMessage, hasStoragePath: !!d.storagePath }, '🔧');
	deps = d;
}

export function hasPending(): boolean {
	return pendingPermissionRequests.size > 0;
}

export function getPendingCount(): number {
	return pendingPermissionRequests.size;
}

export async function handleControlRequest(controlRequest: any): Promise<void> {
	const request = controlRequest.request;
	const requestId = controlRequest.request_id;
	log.debug('Permissions', 'enter handleControlRequest', { requestId, subtype: request?.subtype }, '➡️');

	if (request?.subtype !== 'can_use_tool') {
		log.debug('Permissions', 'not a can_use_tool request, skipping', { subtype: request?.subtype }, '🚫');
		return;
	}

	const toolName = request.tool_name || 'Unknown Tool';
	const input = request.input || {};
	const suggestions = request.permission_suggestions;
	const toolUseId = request.tool_use_id;

	if (toolName === 'AskUserQuestion') {
		log.debug('Permissions', 'routing to AskUserQuestion handler', { requestId }, '🔀');
		handleAskUserQuestion(requestId, input, toolUseId);
		return;
	}

	// YOLO mode is enforced here, not via the CLI's --dangerously-skip-permissions
	// flag (which would suppress the control-request channel AskUserQuestion needs).
	// Auto-approve every other tool so the user gets frictionless behaviour while
	// interactive prompts (like AskUserQuestion above) still reach the webview.
	const yoloMode = vscode.workspace.getConfiguration('ccvi').get<boolean>('permissions.yoloMode', false);
	if (yoloMode) {
		log.debug('Permissions', 'yolo mode — auto-allowing tool', { toolName, requestId }, '🚀');
		sendPermissionResponse(requestId, true, {
			requestId,
			toolName,
			input,
			suggestions,
			toolUseId
		}, false);
		return;
	}

	const isPreApproved = await isToolPreApproved(toolName, input);

	if (isPreApproved) {
		log.debug('Permissions', 'tool pre-approved, auto-allowing', { toolName, requestId }, '✅');
		sendPermissionResponse(requestId, true, {
			requestId,
			toolName,
			input,
			suggestions,
			toolUseId
		}, false);
		return;
	}

	log.debug('Permissions', 'tool requires user approval', { toolName, requestId }, '⏳');
	pendingPermissionRequests.set(requestId, {
		requestId,
		toolName,
		input,
		suggestions,
		toolUseId
	});

	let pattern: string | undefined;
	if (toolName === 'Bash' && input.command) {
		pattern = getCommandPattern(input.command as string);
	}

	conversation.sendAndSaveMessage({
		type: 'permissionRequest',
		data: {
			id: requestId,
			tool: toolName,
			input: input,
			pattern: pattern,
			suggestions: suggestions,
			decisionReason: request.decision_reason,
			blockedPath: request.blocked_path,
			status: 'pending'
		}
	});
	log.debug('Permissions', 'exit handleControlRequest', { requestId, toolName }, '⬅️');
}

function sendPermissionResponse(
	requestId: string,
	approved: boolean,
	pendingRequest: PendingRequest,
	alwaysAllow?: boolean
): void {
	log.debug('Permissions', 'enter sendPermissionResponse', { requestId, approved, alwaysAllow }, '➡️');
	if (!deps?.getStdinAvailable()) {
		log.error('Permissions', 'cannot send permission response — stdin not available', { requestId }, '💥');
		return;
	}

	let response: any;
	if (approved) {
		response = {
			type: 'control_response',
			response: {
				subtype: 'success',
				request_id: requestId,
				response: {
					behavior: 'allow',
					updatedInput: pendingRequest.input,
					updatedPermissions: alwaysAllow ? pendingRequest.suggestions : undefined,
					toolUseID: pendingRequest.toolUseId
				}
			}
		};
	} else {
		response = {
			type: 'control_response',
			response: {
				subtype: 'success',
				request_id: requestId,
				response: {
					behavior: 'deny',
					message: 'User denied permission',
					interrupt: true,
					toolUseID: pendingRequest.toolUseId
				}
			}
		};
	}

	const responseJson = JSON.stringify(response) + '\n';
	deps.writeToStdin(responseJson);
	log.debug('Permissions', 'exit sendPermissionResponse', { requestId, approved }, '⬅️');
}

export function handlePermissionResponse(id: string, approved: boolean, alwaysAllow?: boolean): void {
	log.debug('Permissions', 'enter handlePermissionResponse', { id, approved, alwaysAllow }, '➡️');
	const pendingRequest = pendingPermissionRequests.get(id);
	if (!pendingRequest) {
		log.warn('Permissions', 'no pending request found', { id }, '🚫');
		return;
	}

	pendingPermissionRequests.delete(id);
	sendPermissionResponse(id, approved, pendingRequest, alwaysAllow);

	deps?.postMessage({
		type: 'updatePermissionStatus',
		data: {
			id: id,
			status: approved ? 'approved' : 'denied'
		}
	});

	if (alwaysAllow && approved) {
		log.debug('Permissions', 'saving local permission for always-allow', { toolName: pendingRequest.toolName }, '💾');
		void saveLocalPermission(pendingRequest.toolName, pendingRequest.input);
	}
	log.debug('Permissions', 'exit handlePermissionResponse', { id, approved }, '⬅️');
}

export function handleAskUserQuestion(requestId: string, input: Record<string, unknown>, toolUseId: string): void {
	log.debug('Permissions', 'enter handleAskUserQuestion', { requestId }, '➡️');
	const questions = (input.questions as any[]) || [];

	pendingPermissionRequests.set(requestId, {
		requestId,
		toolName: 'AskUserQuestion',
		input,
		suggestions: undefined,
		toolUseId
	});

	conversation.sendAndSaveMessage({
		type: 'askUserQuestion',
		data: {
			id: requestId,
			questions: questions,
			status: 'pending'
		}
	});
	log.debug('Permissions', 'exit handleAskUserQuestion', { requestId, questionCount: questions.length }, '⬅️');
}

export function handleAskUserQuestionResponse(requestId: string, answers: Record<string, string>, cancelled?: boolean): void {
	log.debug('Permissions', 'enter handleAskUserQuestionResponse', { requestId, answerCount: Object.keys(answers).length, cancelled: !!cancelled }, '➡️');
	const pendingRequest = pendingPermissionRequests.get(requestId);
	if (!pendingRequest) {
		log.warn('Permissions', 'no pending AskUserQuestion request found', { requestId }, '🚫');
		return;
	}

	pendingPermissionRequests.delete(requestId);

	if (!deps?.getStdinAvailable()) {
		log.error('Permissions', 'cannot send AskUserQuestion response — stdin not available', { requestId }, '💥');
		return;
	}

	// When the user clicks Cancel, decline the question via the same deny
	// control-response that permission denials use — tells the CLI the user
	// opted out rather than supplying answers.
	const response = cancelled
		? {
			type: 'control_response',
			response: {
				subtype: 'success',
				request_id: requestId,
				response: {
					behavior: 'deny',
					message: 'User declined to answer',
					interrupt: true,
					toolUseID: pendingRequest.toolUseId
				}
			}
		}
		: {
			type: 'control_response',
			response: {
				subtype: 'success',
				request_id: requestId,
				response: {
					behavior: 'allow',
					updatedInput: {
						questions: (pendingRequest.input as any).questions,
						answers: answers
					},
					toolUseID: pendingRequest.toolUseId
				}
			}
		};

	const responseJson = JSON.stringify(response) + '\n';
	deps.writeToStdin(responseJson);

	const finalStatus = cancelled ? 'cancelled' : 'answered';
	const savedMsg = conversation.getCurrentConversation().find(
		m => m.messageType === 'askUserQuestion' && m.data?.id === requestId
	);
	if (savedMsg) {
		savedMsg.data = { ...savedMsg.data, status: finalStatus, answers: answers };
		void conversation.saveCurrentConversation();
	}

	deps.postMessage({
		type: 'updateAskUserQuestionStatus',
		data: {
			id: requestId,
			status: finalStatus,
			answers: answers
		}
	});
	log.debug('Permissions', 'exit handleAskUserQuestionResponse', { requestId, cancelled: !!cancelled }, '⬅️');
}

export function cancelPendingPermissionRequests(): void {
	log.debug('Permissions', 'enter cancelPendingPermissionRequests', { count: pendingPermissionRequests.size }, '➡️');
	for (const [id, request] of pendingPermissionRequests) {
		if (request.toolName === 'AskUserQuestion') {
			deps?.postMessage({
				type: 'updateAskUserQuestionStatus',
				data: { id, status: 'cancelled', answers: null }
			});
		} else {
			deps?.postMessage({
				type: 'updatePermissionStatus',
				data: { id, status: 'cancelled' }
			});
		}
	}
	pendingPermissionRequests.clear();
	log.debug('Permissions', 'exit cancelPendingPermissionRequests', undefined, '⬅️');
}

export function initializePermissions(): void {
	log.debug('Permissions', 'initializePermissions (no-op)', undefined, '➡️');
}

async function isToolPreApproved(toolName: string, input: Record<string, unknown>): Promise<boolean> {
	log.debug('Permissions', 'enter isToolPreApproved', { toolName }, '➡️');
	try {
		const storagePath = deps?.storagePath;
		if (!storagePath) {
			log.debug('Permissions', 'no storage path, returning false', undefined, '⬅️');
			return false;
		}

		const permissionsUri = vscode.Uri.file(path.join(storagePath, 'permissions', 'permissions.json'));
		let permissions: any = { alwaysAllow: {} };

		try {
			const content = await vscode.workspace.fs.readFile(permissionsUri);
			permissions = JSON.parse(new TextDecoder().decode(content));
		} catch {
			log.debug('Permissions', 'no permissions file, returning false', undefined, '⬅️');
			return false;
		}

		const toolPermission = permissions.alwaysAllow?.[toolName];

		if (toolPermission === true) {
			log.debug('Permissions', 'blanket allow for tool', { toolName }, '✅');
			return true;
		}

		if (Array.isArray(toolPermission) && toolName === 'Bash' && input.command) {
			const command = (input.command as string).trim();
			log.debug('Permissions', 'checking bash command against patterns', { command, patternCount: toolPermission.length }, '🔍');
			for (const pattern of toolPermission) {
				if (matchesPattern(command, pattern)) {
					log.debug('Permissions', 'pattern matched', { command, pattern }, '✅');
					return true;
				}
			}
		}

		log.debug('Permissions', 'no applicable rule, returning false', { toolName }, '⬅️');
		return false;
	} catch (error: any) {
		log.error('Permissions', 'isToolPreApproved threw', { toolName, error: error?.message ?? String(error) }, '💥');
		return false;
	}
}

function matchesPattern(command: string, pattern: string): boolean {
	if (pattern === command) return true;
	if (pattern.endsWith(' *')) {
		const prefix = pattern.slice(0, -1);
		return command.startsWith(prefix);
	}
	return false;
}

export function getCommandPattern(command: string): string {
	const parts = command.trim().split(/\s+/);
	if (parts.length === 0) return command;

	const baseCmd = parts[0];
	const subCmd = parts.length > 1 ? parts[1] : '';

	const patterns: string[][] = [
		['npm', 'install', 'npm install *'], ['npm', 'i', 'npm i *'], ['npm', 'add', 'npm add *'],
		['npm', 'remove', 'npm remove *'], ['npm', 'uninstall', 'npm uninstall *'], ['npm', 'update', 'npm update *'],
		['npm', 'run', 'npm run *'], ['yarn', 'add', 'yarn add *'], ['yarn', 'remove', 'yarn remove *'],
		['yarn', 'install', 'yarn install *'], ['pnpm', 'install', 'pnpm install *'], ['pnpm', 'add', 'pnpm add *'],
		['pnpm', 'remove', 'pnpm remove *'], ['git', 'add', 'git add *'], ['git', 'commit', 'git commit *'],
		['git', 'push', 'git push *'], ['git', 'pull', 'git pull *'], ['git', 'checkout', 'git checkout *'],
		['git', 'branch', 'git branch *'], ['git', 'merge', 'git merge *'], ['git', 'clone', 'git clone *'],
		['git', 'reset', 'git reset *'], ['git', 'rebase', 'git rebase *'], ['git', 'tag', 'git tag *'],
		['docker', 'run', 'docker run *'], ['docker', 'build', 'docker build *'], ['docker', 'exec', 'docker exec *'],
		['docker', 'logs', 'docker logs *'], ['docker', 'stop', 'docker stop *'], ['docker', 'start', 'docker start *'],
		['docker', 'rm', 'docker rm *'], ['docker', 'rmi', 'docker rmi *'], ['docker', 'pull', 'docker pull *'],
		['docker', 'push', 'docker push *'], ['make', '', 'make *'], ['cargo', 'build', 'cargo build *'],
		['cargo', 'run', 'cargo run *'], ['cargo', 'test', 'cargo test *'], ['cargo', 'install', 'cargo install *'],
		['mvn', 'compile', 'mvn compile *'], ['mvn', 'test', 'mvn test *'], ['mvn', 'package', 'mvn package *'],
		['gradle', 'build', 'gradle build *'], ['gradle', 'test', 'gradle test *'], ['curl', '', 'curl *'],
		['wget', '', 'wget *'], ['ssh', '', 'ssh *'], ['scp', '', 'scp *'], ['rsync', '', 'rsync *'],
		['tar', '', 'tar *'], ['zip', '', 'zip *'], ['unzip', '', 'unzip *'], ['node', '', 'node *'],
		['python', '', 'python *'], ['python3', '', 'python3 *'], ['pip', 'install', 'pip install *'],
		['pip3', 'install', 'pip3 install *'], ['composer', 'install', 'composer install *'],
		['composer', 'require', 'composer require *'], ['bundle', 'install', 'bundle install *'],
		['gem', 'install', 'gem install *'],
	];

	for (const [cmd, sub, pattern] of patterns) {
		if (baseCmd === cmd && (sub === '' || subCmd === sub)) {
			return pattern;
		}
	}

	return command;
}

export async function sendPermissions(): Promise<void> {
	log.debug('Permissions', 'enter sendPermissions', undefined, '➡️');
	try {
		const storagePath = deps?.storagePath;
		if (!storagePath) {
			log.debug('Permissions', 'no storage path, sending empty', undefined, '🚫');
			deps?.postMessage({ type: 'permissionsData', data: { alwaysAllow: {} } });
			return;
		}

		const permissionsUri = vscode.Uri.file(path.join(storagePath, 'permissions', 'permissions.json'));
		let permissions: any = { alwaysAllow: {} };

		try {
			const content = await vscode.workspace.fs.readFile(permissionsUri);
			permissions = JSON.parse(new TextDecoder().decode(content));
		} catch { }

		deps?.postMessage({ type: 'permissionsData', data: permissions });
		log.debug('Permissions', 'exit sendPermissions', { toolCount: Object.keys(permissions.alwaysAllow).length }, '⬅️');
	} catch (error: any) {
		log.error('Permissions', 'sendPermissions failed', { error: error?.message ?? String(error) }, '💥');
		deps?.postMessage({ type: 'permissionsData', data: { alwaysAllow: {} } });
	}
}

export async function removePermission(toolName: string, command: string | null): Promise<void> {
	log.debug('Permissions', 'enter removePermission', { toolName, command }, '➡️');
	try {
		const storagePath = deps?.storagePath;
		if (!storagePath) return;

		const permissionsUri = vscode.Uri.file(path.join(storagePath, 'permissions', 'permissions.json'));
		let permissions: any = { alwaysAllow: {} };

		try {
			const content = await vscode.workspace.fs.readFile(permissionsUri);
			permissions = JSON.parse(new TextDecoder().decode(content));
		} catch {
			return;
		}

		if (command === null) {
			delete permissions.alwaysAllow[toolName];
			log.debug('Permissions', 'removed entire tool permission', { toolName }, '🧹');
		} else {
			if (Array.isArray(permissions.alwaysAllow[toolName])) {
				permissions.alwaysAllow[toolName] = permissions.alwaysAllow[toolName].filter(
					(cmd: string) => cmd !== command
				);
				if (permissions.alwaysAllow[toolName].length === 0) {
					delete permissions.alwaysAllow[toolName];
				}
			}
			log.debug('Permissions', 'removed command permission', { toolName, command }, '🧹');
		}

		const permissionsContent = new TextEncoder().encode(JSON.stringify(permissions, null, 2));
		await vscode.workspace.fs.writeFile(permissionsUri, permissionsContent);
		sendPermissions();
		log.debug('Permissions', 'exit removePermission', { toolName }, '⬅️');
	} catch (error: any) {
		log.error('Permissions', 'removePermission failed', { toolName, error: error?.message ?? String(error) }, '💥');
	}
}

export async function addPermission(toolName: string, command: string | null): Promise<void> {
	log.debug('Permissions', 'enter addPermission', { toolName, command }, '➡️');
	try {
		const storagePath = deps?.storagePath;
		if (!storagePath) return;

		const permissionsUri = vscode.Uri.file(path.join(storagePath, 'permissions', 'permissions.json'));
		let permissions: any = { alwaysAllow: {} };

		try {
			const content = await vscode.workspace.fs.readFile(permissionsUri);
			permissions = JSON.parse(new TextDecoder().decode(content));
		} catch { }

		if (command === null || command === '') {
			permissions.alwaysAllow[toolName] = true;
			log.debug('Permissions', 'set blanket allow', { toolName }, '✅');
		} else {
			if (!permissions.alwaysAllow[toolName]) {
				permissions.alwaysAllow[toolName] = [];
			}
			if (permissions.alwaysAllow[toolName] === true) {
				permissions.alwaysAllow[toolName] = [];
			}
			if (Array.isArray(permissions.alwaysAllow[toolName])) {
				let commandToAdd = command;
				if (toolName === 'Bash') {
					commandToAdd = getCommandPattern(command);
				}
				if (!permissions.alwaysAllow[toolName].includes(commandToAdd)) {
					permissions.alwaysAllow[toolName].push(commandToAdd);
				}
			}
			log.debug('Permissions', 'added command permission', { toolName, command }, '✅');
		}

		const permissionsDir = vscode.Uri.file(path.dirname(permissionsUri.fsPath));
		try {
			await vscode.workspace.fs.stat(permissionsDir);
		} catch {
			await vscode.workspace.fs.createDirectory(permissionsDir);
		}

		const permissionsContent = new TextEncoder().encode(JSON.stringify(permissions, null, 2));
		await vscode.workspace.fs.writeFile(permissionsUri, permissionsContent);
		sendPermissions();
		log.debug('Permissions', 'exit addPermission', { toolName }, '⬅️');
	} catch (error: any) {
		log.error('Permissions', 'addPermission failed', { toolName, error: error?.message ?? String(error) }, '💥');
	}
}

async function saveLocalPermission(toolName: string, input: Record<string, unknown>): Promise<void> {
	log.debug('Permissions', 'enter saveLocalPermission', { toolName }, '➡️');
	try {
		const storagePath = deps?.storagePath;
		if (!storagePath) return;

		const permissionsDir = path.join(storagePath, 'permissions');
		try {
			await vscode.workspace.fs.stat(vscode.Uri.file(permissionsDir));
		} catch {
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(permissionsDir));
		}

		const permissionsUri = vscode.Uri.file(path.join(permissionsDir, 'permissions.json'));
		let permissions: any = { alwaysAllow: {} };

		try {
			const content = await vscode.workspace.fs.readFile(permissionsUri);
			permissions = JSON.parse(new TextDecoder().decode(content));
		} catch { }

		if (toolName === 'Bash' && input.command) {
			if (!permissions.alwaysAllow[toolName]) {
				permissions.alwaysAllow[toolName] = [];
			}
			if (Array.isArray(permissions.alwaysAllow[toolName])) {
				const pattern = getCommandPattern(input.command as string);
				if (!permissions.alwaysAllow[toolName].includes(pattern)) {
					permissions.alwaysAllow[toolName].push(pattern);
				}
			}
			log.debug('Permissions', 'saved bash pattern', { pattern: getCommandPattern(input.command as string) }, '💾');
		} else {
			permissions.alwaysAllow[toolName] = true;
			log.debug('Permissions', 'saved blanket allow', { toolName }, '💾');
		}

		const permissionsContent = new TextEncoder().encode(JSON.stringify(permissions, null, 2));
		await vscode.workspace.fs.writeFile(permissionsUri, permissionsContent);
		log.debug('Permissions', 'exit saveLocalPermission', { toolName }, '⬅️');
	} catch (error: any) {
		log.error('Permissions', 'saveLocalPermission failed', { toolName, error: error?.message ?? String(error) }, '💥');
	}
}

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { log } from './logger';

type PostMessageFn = (message: any) => void;

interface SettingsDeps {
	postMessage: PostMessageFn;
	workspaceState: vscode.Memento;
	globalState: vscode.Memento;
}

let deps: SettingsDeps | undefined;
let selectedModel = 'default';

export function init(d: SettingsDeps): void {
	log.info('Settings', 'init', { hasPostMessage: !!d.postMessage }, '🔧');
	deps = d;
	selectedModel = d.workspaceState.get('claude.selectedModel', 'default');
	log.debug('Settings', 'loaded selectedModel from workspace state', { selectedModel }, '📥');
}

export function getSelectedModel(): string {
	return selectedModel;
}

const MODEL_TIER_MAP: Record<string, string> = {
	'default': 'opus',
	'opus': 'opus',
	'sonnet': 'sonnet',
	'haiku': 'haiku',
};

export function getDisplayModel(): string {
	if (MODEL_TIER_MAP[selectedModel]) {
		return MODEL_TIER_MAP[selectedModel]!;
	}
	return selectedModel;
}

// Reads ~/.claude/settings.json for the full provider-qualified model string.
// The CLI's streamed message.model only carries the bare id (e.g. claude-opus-4-8);
// the region prefix and [1m] context-window tag live in this file's top-level `model`
// key. `configured` is the user's chosen default; `resolvedEnv` is the env override
// (env.ANTHROPIC_MODEL) which wins at runtime when the two disagree.
export function getFullModelString(): { configured?: string; resolvedEnv?: string } {
	try {
		const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
		const json = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
		return {
			configured: typeof json.model === 'string' ? json.model : undefined,
			resolvedEnv: typeof json.env?.ANTHROPIC_MODEL === 'string' ? json.env.ANTHROPIC_MODEL : undefined,
		};
	} catch (error: any) {
		log.debug('Settings', 'getFullModelString failed', { error: error?.message ?? String(error) }, '⚠️');
		return {};
	}
}

export function sendCurrentSettings(): void {
	log.debug('Settings', 'enter sendCurrentSettings', undefined, '➡️');
	const config = vscode.workspace.getConfiguration('claudeCodeChat');
	const settings = {
		'thinking.intensity': config.get<string>('thinking.intensity', 'think'),
		'wsl.enabled': config.get<boolean>('wsl.enabled', false),
		'wsl.distro': config.get<string>('wsl.distro', 'Ubuntu'),
		'wsl.nodePath': config.get<string>('wsl.nodePath', ''),
		'wsl.claudePath': config.get<string>('wsl.claudePath', '/usr/local/bin/claude'),
		'permissions.yoloMode': config.get<boolean>('permissions.yoloMode', false),
		'executable.path': config.get<string>('executable.path', ''),
		'environment.variables': config.get<Record<string, string>>('environment.variables', {}),
		'environment.disabled': config.get<boolean>('environment.disabled', false),
		'terminal.useIntegrated': config.get<boolean>('terminal.useIntegrated', true),
		'terminal.externalApp': config.get<string>('terminal.externalApp', ''),
		'terminal.customTemplate': config.get<string>('terminal.customTemplate', '')
	};

	deps?.postMessage({
		type: 'settingsData',
		data: settings
	});
	log.debug('Settings', 'exit sendCurrentSettings', undefined, '⬅️');
}

export async function setEnvsDisabled(disabled: boolean): Promise<void> {
	log.debug('Settings', 'enter setEnvsDisabled', { disabled }, '➡️');
	const config = vscode.workspace.getConfiguration('claudeCodeChat');
	await config.update('environment.disabled', disabled, vscode.ConfigurationTarget.Global);
	sendCurrentSettings();
	log.debug('Settings', 'exit setEnvsDisabled', undefined, '⬅️');
}

export async function updateSettings(settings: { [key: string]: any }): Promise<void> {
	log.debug('Settings', 'enter updateSettings', { keys: Object.keys(settings) }, '➡️');
	const config = vscode.workspace.getConfiguration('claudeCodeChat');

	try {
		for (const [key, value] of Object.entries(settings)) {
			if (key === 'permissions.yoloMode') {
				try {
					await config.update(key, value, vscode.ConfigurationTarget.Workspace);
					log.debug('Settings', 'updated yoloMode at workspace level', { key, value }, '⚙️');
				} catch {
					await config.update(key, value, vscode.ConfigurationTarget.Global);
					log.debug('Settings', 'updated yoloMode at global level (workspace failed)', { key, value }, '⚙️');
				}
			} else {
				await config.update(key, value, vscode.ConfigurationTarget.Global);
				log.debug('Settings', 'updated setting', { key, value }, '⚙️');
			}
		}

		sendCurrentSettings();
		log.debug('Settings', 'exit updateSettings', undefined, '⬅️');
	} catch (error: any) {
		log.error('Settings', 'updateSettings failed', { error: error?.message ?? String(error) }, '💥');
		vscode.window.showErrorMessage(`Failed to update settings: ${error?.message || 'Unknown error'}`);
	}
}

export async function setSelectedModel(model: string, tierModels?: { sonnet: string; opus: string; haiku: string }): Promise<void> {
	log.debug('Settings', 'enter setSelectedModel', { model, tierModels }, '➡️');
	const validClaudeModels = ['opus', 'sonnet', 'default'];

	if (validClaudeModels.includes(model)) {
		log.debug('Settings', 'standard claude model selected', { model }, '🔀');
		selectedModel = model;
		deps?.workspaceState.update('claude.selectedModel', model);
		await removeModelEnvVars();
		sendCurrentSettings();
		deps?.postMessage({ type: 'modelSwitched', model: model });
		vscode.window.showInformationMessage(`Model switched to: ${model.charAt(0).toUpperCase() + model.slice(1)}`);
	} else {
		log.debug('Settings', 'custom model selected, setting env vars', { model, tierModels }, '🔀');
		selectedModel = model;
		deps?.workspaceState.update('claude.selectedModel', model);
		await setModelEnvVars(model, tierModels);

		deps?.postMessage({
			type: 'modelSwitching',
			model: model
		});

		deps?.postMessage({
			type: 'modelSwitched',
			model: model
		});

		vscode.window.showInformationMessage(`Model switched to: ${model}`);
	}
	log.debug('Settings', 'exit setSelectedModel', { selectedModel }, '⬅️');
}

export async function setModelEnvVars(model: string, tierModels?: { sonnet: string; opus: string; haiku: string }): Promise<void> {
	log.debug('Settings', 'enter setModelEnvVars', { model, tierModels }, '➡️');
	const config = vscode.workspace.getConfiguration('claudeCodeChat');
	const envVars = config.get<Record<string, string>>('environment.variables', {});
	envVars['ANTHROPIC_DEFAULT_SONNET_MODEL'] = tierModels?.sonnet || model;
	envVars['ANTHROPIC_DEFAULT_OPUS_MODEL'] = tierModels?.opus || model;
	envVars['ANTHROPIC_DEFAULT_HAIKU_MODEL'] = tierModels?.haiku || model;
	await config.update('environment.variables', envVars, vscode.ConfigurationTarget.Global);
	log.debug('Settings', 'exit setModelEnvVars', { sonnet: envVars['ANTHROPIC_DEFAULT_SONNET_MODEL'], opus: envVars['ANTHROPIC_DEFAULT_OPUS_MODEL'], haiku: envVars['ANTHROPIC_DEFAULT_HAIKU_MODEL'] }, '⬅️');
}

export async function removeModelEnvVars(): Promise<void> {
	log.debug('Settings', 'enter removeModelEnvVars', undefined, '➡️');
	const config = vscode.workspace.getConfiguration('claudeCodeChat');
	const envVars = config.get<Record<string, string>>('environment.variables', {});
	const filtered: Record<string, string> = {};
	for (const [key, value] of Object.entries(envVars)) {
		if (key !== 'ANTHROPIC_DEFAULT_SONNET_MODEL' &&
			key !== 'ANTHROPIC_DEFAULT_OPUS_MODEL' &&
			key !== 'ANTHROPIC_DEFAULT_HAIKU_MODEL') {
			filtered[key] = value;
		}
	}
	await config.update('environment.variables', filtered, vscode.ConfigurationTarget.Global);
	log.debug('Settings', 'exit removeModelEnvVars', { remainingKeys: Object.keys(filtered) }, '⬅️');
}

export async function sendCustomSnippets(globalState: vscode.Memento): Promise<void> {
	log.debug('Settings', 'enter sendCustomSnippets', undefined, '➡️');
	try {
		const customSnippets = globalState.get<{ [key: string]: any }>('customPromptSnippets', {});
		deps?.postMessage({
			type: 'customSnippetsData',
			data: customSnippets
		});
		log.debug('Settings', 'exit sendCustomSnippets', { snippetCount: Object.keys(customSnippets).length }, '⬅️');
	} catch (error: any) {
		log.error('Settings', 'sendCustomSnippets failed', { error: error?.message ?? String(error) }, '💥');
		deps?.postMessage({
			type: 'customSnippetsData',
			data: {}
		});
	}
}

export async function saveCustomSnippet(snippet: any, globalState: vscode.Memento): Promise<void> {
	log.debug('Settings', 'enter saveCustomSnippet', { snippetId: snippet?.id }, '➡️');
	try {
		const customSnippets = globalState.get<{ [key: string]: any }>('customPromptSnippets', {});
		customSnippets[snippet.id] = snippet;
		await globalState.update('customPromptSnippets', customSnippets);
		deps?.postMessage({
			type: 'customSnippetSaved',
			data: { snippet }
		});
		log.debug('Settings', 'exit saveCustomSnippet', { snippetId: snippet.id }, '⬅️');
	} catch (error: any) {
		log.error('Settings', 'saveCustomSnippet failed', { error: error?.message ?? String(error) }, '💥');
		deps?.postMessage({
			type: 'error',
			data: 'Failed to save custom snippet'
		});
	}
}

export async function deleteCustomSnippet(snippetId: string, globalState: vscode.Memento): Promise<void> {
	log.debug('Settings', 'enter deleteCustomSnippet', { snippetId }, '➡️');
	try {
		const customSnippets = globalState.get<{ [key: string]: any }>('customPromptSnippets', {});
		if (customSnippets[snippetId]) {
			delete customSnippets[snippetId];
			await globalState.update('customPromptSnippets', customSnippets);
			deps?.postMessage({
				type: 'customSnippetDeleted',
				data: { snippetId }
			});
			log.debug('Settings', 'exit deleteCustomSnippet — deleted', { snippetId }, '⬅️');
		} else {
			log.debug('Settings', 'exit deleteCustomSnippet — not found', { snippetId }, '🚫');
			deps?.postMessage({
				type: 'error',
				data: 'Snippet not found'
			});
		}
	} catch (error: any) {
		log.error('Settings', 'deleteCustomSnippet failed', { error: error?.message ?? String(error) }, '💥');
		deps?.postMessage({
			type: 'error',
			data: 'Failed to delete custom snippet'
		});
	}
}

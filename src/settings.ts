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
// Thinking controls, extension-owned (injected at spawn via --settings; never
// written to the dev's settings.local.json). workspaceState is the live value;
// package.json config is the seed/default and only applies until the user sets one.
let effort: string | undefined;   // undefined = inherit the model's default effort
let thoughtsOn = true;            // true = display 'summarized', false = 'omitted'

// Config keys that existed under the legacy `claudeCodeChat.*` namespace before
// the rename to `ccvc.*`. The suffixes are unchanged — only the root moved.
const LEGACY_CONFIG_KEYS = [
	'wsl.enabled', 'wsl.distro', 'wsl.nodePath', 'wsl.claudePath',
	'thinking.show', 'thinking.effort', 'permissions.yoloMode', 'executable.path',
	'environment.variables', 'environment.disabled',
	'terminal.useIntegrated', 'terminal.externalApp', 'terminal.customTemplate',
	'terminal.borderColor', 'terminal.fontColor', 'firstRun.hasShown',
];

// One-time migration: a namespace rename would otherwise silently orphan the
// user's saved values (VS Code would find nothing under `ccvc.*` and fall back
// to declared defaults). This copies any legacy `claudeCodeChat.<key>` value to
// `ccvc.<key>` when the new key is unset, preserving the original scope
// (workspace vs global). Copy-only — the old keys are left in place (harmless)
// so the change stays reversible. Idempotent: gated by a sentinel and a per-key
// "new value already set" guard, so it never clobbers a choice made under ccvc.
export async function migrateLegacyConfig(): Promise<void> {
	const oldCfg = vscode.workspace.getConfiguration('claudeCodeChat');
	const newCfg = vscode.workspace.getConfiguration('ccvc');
	if (newCfg.get<boolean>('migratedFromClaudeCodeChat')) {
		return;
	}
	let migrated = 0;
	for (const key of LEGACY_CONFIG_KEYS) {
		const inspected = oldCfg.inspect(key);
		const oldVal = inspected?.workspaceValue ?? inspected?.globalValue;
		const newInspected = newCfg.inspect(key);
		const newAlreadySet = newInspected?.workspaceValue !== undefined || newInspected?.globalValue !== undefined;
		if (oldVal !== undefined && !newAlreadySet) {
			const target = inspected?.workspaceValue !== undefined
				? vscode.ConfigurationTarget.Workspace
				: vscode.ConfigurationTarget.Global;
			try {
				await newCfg.update(key, oldVal, target);
				migrated++;
			} catch (e) {
				log.warn('Settings', 'migrateLegacyConfig: copy failed', { key, error: (e as any)?.message ?? String(e) }, '⚠️');
			}
		}
	}
	await newCfg.update('migratedFromClaudeCodeChat', true, vscode.ConfigurationTarget.Global);
	log.info('Settings', 'migrateLegacyConfig done', { migrated }, '🔄');
}

export function init(d: SettingsDeps): void {
	log.info('Settings', 'init', { hasPostMessage: !!d.postMessage }, '🔧');
	deps = d;
	selectedModel = d.workspaceState.get('claude.selectedModel', 'default');
	const cfg = vscode.workspace.getConfiguration('ccvc');
	const wsThoughts = d.workspaceState.get<boolean | undefined>('claude.thoughtsOn', undefined);
	thoughtsOn = typeof wsThoughts === 'boolean' ? wsThoughts : cfg.get<boolean>('thinking.show', true);
	const wsEffort = d.workspaceState.get<string | undefined>('claude.effort', undefined);
	const cfgEffort = (cfg.get<string>('thinking.effort', '') || '').trim();
	effort = (typeof wsEffort === 'string' && wsEffort) ? wsEffort : (cfgEffort || undefined);
	log.debug('Settings', 'loaded thinking prefs', { selectedModel, effort, thoughtsOn }, '📥');
}

export function getSelectedModel(): string {
	return selectedModel;
}

// Record the selected model without the env-var / settings-file dance. Used by
// the in-band set_model path (Phase 2): the live process already switched via
// the control protocol, so we only need to persist the choice for the status
// bar and the next spawn. Does NOT touch env vars or settings.local.json.
export function recordSelectedModel(model: string): void {
	selectedModel = model;
	deps?.workspaceState.update('claude.selectedModel', model);
	log.debug('Settings', 'recordSelectedModel', { model }, '📝');
}

// ── Thinking controls (Effort depth + Thoughts visibility) ─────────────────
// Extension-owned prefs injected at spawn via --settings. Never written to the
// dev's settings.local.json (build-to-contract: we set the advertised keys; the
// provider honors them where it can — e.g. first-party / Opus 4.6).

export function getEffort(): string | undefined {
	return effort;
}

// level: one of the selected model's supportedEffortLevels, or undefined/'' to
// clear (inherit the model's default). Stored in workspaceState (the live value).
export function setEffort(level: string | undefined): void {
	effort = level && level.trim() ? level : undefined;
	deps?.workspaceState.update('claude.effort', effort);
	log.debug('Settings', 'setEffort', { effort }, '📝');
}

export function getThoughtsOn(): boolean {
	return thoughtsOn;
}

export function setThoughtsOn(on: boolean): void {
	thoughtsOn = !!on;
	deps?.workspaceState.update('claude.thoughtsOn', thoughtsOn);
	log.debug('Settings', 'setThoughtsOn', { thoughtsOn }, '📝');
}

// Build the `--settings` JSON injected at spawn for the selected model's thinking
// prefs, gated on the model's advertised capability flags (gate #2). Returns
// undefined when there's nothing to set. We set the advertised keys per the
// contract; the provider honors them where it can (first-party / Opus 4.6) and
// silently ignores them where it can't (e.g. Bedrock-4.8) — not our concern.
//
// Note: alias/legacy catalog entries ('default', 'haiku', opus-4-1) carry NONE of
// the flags, and the catalog may not be loaded on the very first spawn — in both
// cases we inject nothing (consistent with the UI hiding the controls). A user
// picks a concrete model to steer thoughts/effort.
export function buildThinkingSettingsArg(models: any[] | undefined, modelValue: string): string | undefined {
	const entry = Array.isArray(models) ? models.find(m => m?.value === modelValue) : undefined;
	const s: Record<string, unknown> = {};
	if (entry?.supportsAdaptiveThinking) {
		s.thinkingDisplay = thoughtsOn ? 'summarized' : 'omitted';
		s.showThinkingSummaries = thoughtsOn;
	}
	if (entry?.supportsEffort && effort) {
		s.effort = effort;
	}
	if (Object.keys(s).length === 0) { return undefined; }
	return JSON.stringify(s);
}

// Signature of the user's thinking prefs (model-INDEPENDENT — model switches
// happen in-band via set_model and must not force a respawn). When this changes,
// the next turn respawns to re-inject --settings (the warm process can't pick up
// new --settings in-band).
export function getThinkingSig(): string {
	return `${effort ?? ''}|${thoughtsOn}`;
}

// Push the current thinking-control state to the webview (the pickers reflect it;
// capability flags are derived webview-side from the modelList catalog).
export function sendThoughtControlConfig(): void {
	deps?.postMessage({
		type: 'thoughtControlConfig',
		data: { thoughtsOn, effort },
	});
	log.debug('Settings', 'sent thoughtControlConfig', { thoughtsOn, effort }, '📤');
}

// Path to the project-level CLI settings the extension manages: <workspace>/.claude/settings.local.json.
// This is the file the Claude CLI reads first in its settings hierarchy, so writing
// the `model` key here lets us steer the model without passing --model (which would
// override the user's globally-pinned model). Returns undefined with no workspace open.
function getLocalSettingsPath(): string | undefined {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) return undefined;
	return path.join(folder.uri.fsPath, '.claude', 'settings.local.json');
}

function readLocalSettings(): Record<string, any> {
	const p = getLocalSettingsPath();
	if (!p) return {};
	try {
		return JSON.parse(fs.readFileSync(p, 'utf8'));
	} catch {
		return {};
	}
}

// Returns the `model` configured in the project's settings.local.json, or undefined
// if unset / no workspace. This is the source of truth for what the CLI will use.
export function getLocalModel(): string | undefined {
	const json = readLocalSettings();
	return typeof json.model === 'string' && json.model.trim() ? json.model : undefined;
}

// Writes (or clears, when given an empty string) the `model` key in the project's
// settings.local.json, preserving all other keys and creating the file/dir if needed.
export async function setLocalModel(model: string): Promise<void> {
	log.debug('Settings', 'enter setLocalModel', { model }, '➡️');
	const p = getLocalSettingsPath();
	if (!p) {
		log.warn('Settings', 'no workspace folder, cannot write settings.local.json', undefined, '🚫');
		vscode.window.showWarningMessage('Open a workspace folder to configure the model.');
		return;
	}
	try {
		const json = readLocalSettings();
		const trimmed = model.trim();
		if (trimmed) {
			json.model = trimmed;
		} else {
			delete json.model;
		}
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n', 'utf8');
		log.debug('Settings', 'wrote model to settings.local.json', { model: trimmed }, '💾');
		sendModelConfig();
	} catch (error: any) {
		log.error('Settings', 'setLocalModel failed', { error: error?.message ?? String(error) }, '💥');
		vscode.window.showErrorMessage(`Failed to write model setting: ${error?.message || 'Unknown error'}`);
	}
}

// Sends the currently-configured model (from settings.local.json) plus the global
// default (from ~/.claude/settings.json) to the webview so the status bar and the
// settings UI can display the real configured model and pre-fill the first-run prompt.
export function sendModelConfig(): void {
	const local = getLocalModel();
	const global = getFullModelString();
	deps?.postMessage({
		type: 'modelConfig',
		data: {
			model: local,
			globalDefault: global.configured,
			needsFirstRun: !local,
		},
	});
	log.debug('Settings', 'sent modelConfig', { local, globalDefault: global.configured }, '📤');
	// Piggyback the thinking-control state so the Effort/Thoughts pickers populate
	// on the same request the webview already makes for model config.
	sendThoughtControlConfig();
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

// Fallback for the mode picker when the user hasn't customized `ccvc.modes.items`
// (kept in sync with the package.json default). Mirrors the package.json shape.
const DEFAULT_MODE_ITEMS = [
	{ id: 'agent', label: 'Agent', command: '/modes agent' },
	{ id: 'plan', label: 'Plan', command: '/modes plan ./doc' },
];

export function sendCurrentSettings(): void {
	log.debug('Settings', 'enter sendCurrentSettings', undefined, '➡️');
	const config = vscode.workspace.getConfiguration('ccvc');
	const settings = {
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
		'terminal.customTemplate': config.get<string>('terminal.customTemplate', ''),
		'modes.items': config.get<Array<{ id: string; label: string; command: string }>>('modes.items', DEFAULT_MODE_ITEMS)
	};

	deps?.postMessage({
		type: 'settingsData',
		data: settings
	});
	log.debug('Settings', 'exit sendCurrentSettings', undefined, '⬅️');
}

export async function setEnvsDisabled(disabled: boolean): Promise<void> {
	log.debug('Settings', 'enter setEnvsDisabled', { disabled }, '➡️');
	const config = vscode.workspace.getConfiguration('ccvc');
	await config.update('environment.disabled', disabled, vscode.ConfigurationTarget.Global);
	sendCurrentSettings();
	log.debug('Settings', 'exit setEnvsDisabled', undefined, '⬅️');
}

export async function updateSettings(settings: { [key: string]: any }): Promise<void> {
	log.debug('Settings', 'enter updateSettings', { keys: Object.keys(settings) }, '➡️');
	const config = vscode.workspace.getConfiguration('ccvc');

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
		vscode.window.showInformationMessage(`Model switched to: ${model.charAt(0).toUpperCase() + model.slice(1)}`);
	} else {
		log.debug('Settings', 'custom model selected, setting env vars', { model, tierModels }, '🔀');
		selectedModel = model;
		deps?.workspaceState.update('claude.selectedModel', model);
		await setModelEnvVars(model, tierModels);
		vscode.window.showInformationMessage(`Model switched to: ${model}`);
	}
	log.debug('Settings', 'exit setSelectedModel', { selectedModel }, '⬅️');
}

export async function setModelEnvVars(model: string, tierModels?: { sonnet: string; opus: string; haiku: string }): Promise<void> {
	log.debug('Settings', 'enter setModelEnvVars', { model, tierModels }, '➡️');
	const config = vscode.workspace.getConfiguration('ccvc');
	const envVars = config.get<Record<string, string>>('environment.variables', {});
	envVars['ANTHROPIC_DEFAULT_SONNET_MODEL'] = tierModels?.sonnet || model;
	envVars['ANTHROPIC_DEFAULT_OPUS_MODEL'] = tierModels?.opus || model;
	envVars['ANTHROPIC_DEFAULT_HAIKU_MODEL'] = tierModels?.haiku || model;
	await config.update('environment.variables', envVars, vscode.ConfigurationTarget.Global);
	log.debug('Settings', 'exit setModelEnvVars', { sonnet: envVars['ANTHROPIC_DEFAULT_SONNET_MODEL'], opus: envVars['ANTHROPIC_DEFAULT_OPUS_MODEL'], haiku: envVars['ANTHROPIC_DEFAULT_HAIKU_MODEL'] }, '⬅️');
}

export async function removeModelEnvVars(): Promise<void> {
	log.debug('Settings', 'enter removeModelEnvVars', undefined, '➡️');
	const config = vscode.workspace.getConfiguration('ccvc');
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

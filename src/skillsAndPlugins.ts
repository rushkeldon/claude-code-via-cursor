import * as vscode from 'vscode';
import * as path from 'path';
import { log } from './logger';

type PostMessageFn = (message: any) => void;

interface SkillsDeps {
	postMessage: PostMessageFn;
	storagePath: string | undefined;
}

let deps: SkillsDeps | undefined;

export function init(d: SkillsDeps): void {
	log.info('SkillsPlugins', 'init', { hasPostMessage: !!d.postMessage, hasStoragePath: !!d.storagePath }, '🔧');
	deps = d;
}

export async function loadSkills(): Promise<void> {
	log.debug('SkillsPlugins', 'enter loadSkills', undefined, '➡️');
	const skills: { name: string; scope: string; description: string; content: string }[] = [];
	const homeDir = process.env.HOME || process.env.USERPROFILE || '';

	const personalDir = path.join(homeDir, '.claude', 'skills');
	try {
		const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(personalDir));
		for (const [name, type] of entries) {
			if (type === vscode.FileType.Directory) {
				const skillPath = path.join(personalDir, name, 'SKILL.md');
				try {
					const content = await vscode.workspace.fs.readFile(vscode.Uri.file(skillPath));
					const text = new TextDecoder().decode(content);
					const descMatch = text.match(/description:\s*(.+)/);
					const bodyMatch = text.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
					skills.push({ name, scope: 'personal', description: descMatch ? descMatch[1].trim() : '', content: bodyMatch ? bodyMatch[1].trim() : text });
				} catch { }
			}
		}
	} catch { }

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceFolder) {
		const projectDir = path.join(workspaceFolder, '.claude', 'skills');
		try {
			const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(projectDir));
			for (const [name, type] of entries) {
				if (type === vscode.FileType.Directory) {
					const skillPath = path.join(projectDir, name, 'SKILL.md');
					try {
						const content = await vscode.workspace.fs.readFile(vscode.Uri.file(skillPath));
						const text = new TextDecoder().decode(content);
						const descMatch = text.match(/description:\s*(.+)/);
						const bodyMatch = text.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
						skills.push({ name, scope: 'project', description: descMatch ? descMatch[1].trim() : '', content: bodyMatch ? bodyMatch[1].trim() : text });
					} catch { }
				}
			}
		} catch { }
	}

	deps?.postMessage({ type: 'skillsList', data: skills });
	log.debug('SkillsPlugins', 'exit loadSkills', { count: skills.length }, '⬅️');
}

export async function saveSkill(name: string, scope: string, content: string): Promise<void> {
	log.debug('SkillsPlugins', 'enter saveSkill', { name, scope }, '➡️');
	try {
		let baseDir: string;
		if (scope === 'project') {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!workspaceFolder) { throw new Error('No workspace folder'); }
			baseDir = path.join(workspaceFolder, '.claude', 'skills');
		} else {
			const homeDir = process.env.HOME || process.env.USERPROFILE || '';
			baseDir = path.join(homeDir, '.claude', 'skills');
		}

		const skillDir = path.join(baseDir, name);
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(skillDir));
		const skillPath = path.join(skillDir, 'SKILL.md');
		await vscode.workspace.fs.writeFile(vscode.Uri.file(skillPath), new TextEncoder().encode(content));

		deps?.postMessage({ type: 'skillSaved', data: { name } });
		vscode.window.showInformationMessage(`Skill "${name}" created successfully.`);
		log.debug('SkillsPlugins', 'exit saveSkill', { name }, '⬅️');
	} catch (err: any) {
		log.error('SkillsPlugins', 'saveSkill failed', { name, error: err?.message ?? String(err) }, '💥');
		vscode.window.showErrorMessage(`Failed to create skill: ${err.message}`);
	}
}

export async function deleteSkill(name: string, scope: string): Promise<void> {
	log.debug('SkillsPlugins', 'enter deleteSkill', { name, scope }, '➡️');
	try {
		let baseDir: string;
		if (scope === 'project') {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!workspaceFolder) { throw new Error('No workspace folder'); }
			baseDir = path.join(workspaceFolder, '.claude', 'skills');
		} else {
			const homeDir = process.env.HOME || process.env.USERPROFILE || '';
			baseDir = path.join(homeDir, '.claude', 'skills');
		}

		const skillDir = path.join(baseDir, name);
		await vscode.workspace.fs.delete(vscode.Uri.file(skillDir), { recursive: true });

		deps?.postMessage({ type: 'skillDeleted', data: { name } });
		vscode.window.showInformationMessage(`Skill "${name}" deleted.`);
		log.debug('SkillsPlugins', 'exit deleteSkill', { name }, '⬅️');
	} catch (err: any) {
		log.error('SkillsPlugins', 'deleteSkill failed', { name, error: err?.message ?? String(err) }, '💥');
		vscode.window.showErrorMessage(`Failed to delete skill: ${err.message}`);
	}
}

export async function searchSkills(query: string): Promise<void> {
	log.debug('SkillsPlugins', 'enter searchSkills', { query }, '➡️');
	try {
		const res = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=20`);
		if (!res.ok) { throw new Error('HTTP ' + res.status); }
		const data = await res.json() as any;
		deps?.postMessage({ type: 'skillsSearchResponse', data });
		log.debug('SkillsPlugins', 'exit searchSkills', { resultCount: data?.skills?.length ?? 0 }, '⬅️');
	} catch (err: any) {
		log.error('SkillsPlugins', 'searchSkills failed', { query, error: err?.message ?? String(err) }, '💥');
		deps?.postMessage({ type: 'skillsSearchResponse', data: { skills: [] } });
	}
}

async function getClaudeSettingsPath(): Promise<string | undefined> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspaceFolder) { return undefined; }
	return path.join(workspaceFolder, '.claude', 'settings.json');
}

async function readClaudeSettings(): Promise<any> {
	const settingsPath = await getClaudeSettingsPath();
	if (!settingsPath) { return {}; }
	try {
		const content = await vscode.workspace.fs.readFile(vscode.Uri.file(settingsPath));
		return JSON.parse(new TextDecoder().decode(content));
	} catch {
		return {};
	}
}

async function writeClaudeSettings(settings: any): Promise<void> {
	const settingsPath = await getClaudeSettingsPath();
	if (!settingsPath) { return; }
	const dirPath = path.dirname(settingsPath);
	await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
	await vscode.workspace.fs.writeFile(
		vscode.Uri.file(settingsPath),
		new TextEncoder().encode(JSON.stringify(settings, null, 2) + '\n')
	);
}

export async function loadPlugins(): Promise<void> {
	log.debug('SkillsPlugins', 'enter loadPlugins', undefined, '➡️');
	const settings = await readClaudeSettings();
	const enabled = settings.enabledPlugins || {};
	deps?.postMessage({ type: 'pluginsList', data: { enabled } });
	log.debug('SkillsPlugins', 'exit loadPlugins', { enabledCount: Object.keys(enabled).length }, '⬅️');
}

export async function installPlugin(installId: string): Promise<void> {
	log.debug('SkillsPlugins', 'enter installPlugin', { installId }, '➡️');
	try {
		const settings = await readClaudeSettings();
		if (!settings.enabledPlugins) { settings.enabledPlugins = {}; }
		settings.enabledPlugins[installId] = true;
		await writeClaudeSettings(settings);
		deps?.postMessage({ type: 'pluginInstalled', data: { installId } });
		vscode.window.showInformationMessage(`Plugin "${installId.replace(/@.*$/, '')}" enabled.`);
		log.debug('SkillsPlugins', 'exit installPlugin', { installId }, '⬅️');
	} catch (err: any) {
		log.error('SkillsPlugins', 'installPlugin failed', { installId, error: err?.message ?? String(err) }, '💥');
		vscode.window.showErrorMessage(`Failed to enable plugin: ${err.message}`);
	}
}

export async function removePlugin(installId: string): Promise<void> {
	log.debug('SkillsPlugins', 'enter removePlugin', { installId }, '➡️');
	try {
		const settings = await readClaudeSettings();
		if (settings.enabledPlugins) {
			delete settings.enabledPlugins[installId];
			if (Object.keys(settings.enabledPlugins).length === 0) {
				delete settings.enabledPlugins;
			}
		}
		await writeClaudeSettings(settings);
		deps?.postMessage({ type: 'pluginRemoved', data: { installId } });
		vscode.window.showInformationMessage(`Plugin "${installId.replace(/@.*$/, '')}" removed.`);
		log.debug('SkillsPlugins', 'exit removePlugin', { installId }, '⬅️');
	} catch (err: any) {
		log.error('SkillsPlugins', 'removePlugin failed', { installId, error: err?.message ?? String(err) }, '💥');
		vscode.window.showErrorMessage(`Failed to remove plugin: ${err.message}`);
	}
}

export async function fetchMarketplace(url: string, append?: boolean, isSearch?: boolean): Promise<void> {
	log.debug('SkillsPlugins', 'enter fetchMarketplace', { url, append, isSearch }, '➡️');
	try {
		const res = await fetch(url, {
			headers: { 'accept': 'application/json' }
		});
		if (!res.ok) { throw new Error('HTTP ' + res.status); }
		const data = await res.json() as any;
		data._append = !!append;
		data._isSearch = !!isSearch;
		deps?.postMessage({ type: 'marketplaceResponse', data });
		log.debug('SkillsPlugins', 'exit fetchMarketplace', undefined, '⬅️');
	} catch (err: any) {
		log.error('SkillsPlugins', 'fetchMarketplace failed', { url, error: err?.message ?? String(err) }, '💥');
		deps?.postMessage({ type: 'marketplaceError', data: { error: err.message } });
	}
}

function getExtensionMCPConfigPath(): string | undefined {
	const storagePath = deps?.storagePath;
	if (!storagePath) { return undefined; }
	return path.join(storagePath, 'mcp', 'mcp-servers.json');
}

function getMCPConfigPathForScope(scope: string): string | undefined {
	if (scope === 'global') {
		const homeDir = process.env.HOME || process.env.USERPROFILE || '';
		return homeDir ? path.join(homeDir, '.claude.json') : undefined;
	}
	if (scope === 'project') {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		return workspaceFolder ? path.join(workspaceFolder, '.mcp.json') : undefined;
	}
	return getExtensionMCPConfigPath();
}

async function readMCPConfigFile(filePath: string): Promise<Record<string, any>> {
	try {
		const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
		const config = JSON.parse(new TextDecoder().decode(content));
		return config.mcpServers || {};
	} catch {
		return {};
	}
}

export async function loadMCPServers(): Promise<void> {
	log.debug('SkillsPlugins', 'enter loadMCPServers', undefined, '➡️');
	try {
		const servers: Record<string, any> = {};

		const extPath = getExtensionMCPConfigPath();
		if (extPath) {
			const extServers = await readMCPConfigFile(extPath);
			for (const [name, config] of Object.entries(extServers)) {
				servers[name] = { ...config as any, _scope: 'extension' };
			}
		}

		const projectPath = getMCPConfigPathForScope('project');
		if (projectPath) {
			const projectServers = await readMCPConfigFile(projectPath);
			for (const [name, config] of Object.entries(projectServers)) {
				if (!servers[name]) {
					servers[name] = { ...config as any, _scope: 'project' };
				}
			}
		}

		const globalPath = getMCPConfigPathForScope('global');
		if (globalPath) {
			const globalServers = await readMCPConfigFile(globalPath);
			for (const [name, config] of Object.entries(globalServers)) {
				if (!servers[name]) {
					servers[name] = { ...config as any, _scope: 'global' };
				}
			}
		}

		deps?.postMessage({ type: 'mcpServers', data: servers });
		log.debug('SkillsPlugins', 'exit loadMCPServers', { serverCount: Object.keys(servers).length }, '⬅️');
	} catch (error: any) {
		log.error('SkillsPlugins', 'loadMCPServers failed', { error: error?.message ?? String(error) }, '💥');
		deps?.postMessage({ type: 'mcpServerError', data: { error: 'Failed to load MCP servers' } });
	}
}

export async function saveMCPServer(name: string, config: any, scope: string): Promise<void> {
	log.debug('SkillsPlugins', 'enter saveMCPServer', { name, scope }, '➡️');
	try {
		const cleanConfig = { ...config };
		delete cleanConfig._scope;

		const configPath = getMCPConfigPathForScope(scope);
		if (!configPath) {
			deps?.postMessage({ type: 'mcpServerError', data: { error: scope === 'project' ? 'No workspace folder open' : 'Config path not available' } });
			return;
		}

		if (scope === 'extension') {
			const dir = vscode.Uri.file(path.dirname(configPath));
			try { await vscode.workspace.fs.stat(dir); } catch {
				await vscode.workspace.fs.createDirectory(dir);
			}
		}

		const configUri = vscode.Uri.file(configPath);
		let fileConfig: any = {};

		try {
			const content = await vscode.workspace.fs.readFile(configUri);
			fileConfig = JSON.parse(new TextDecoder().decode(content));
		} catch { }

		if (!fileConfig.mcpServers) {
			fileConfig.mcpServers = {};
		}

		fileConfig.mcpServers[name] = cleanConfig;

		const configContent = new TextEncoder().encode(JSON.stringify(fileConfig, null, 2));
		await vscode.workspace.fs.writeFile(configUri, configContent);

		deps?.postMessage({ type: 'mcpServerSaved', data: { name } });
		log.debug('SkillsPlugins', 'exit saveMCPServer', { name, scope }, '⬅️');
	} catch (error: any) {
		log.error('SkillsPlugins', 'saveMCPServer failed', { name, scope, error: error?.message ?? String(error) }, '💥');
		deps?.postMessage({ type: 'mcpServerError', data: { error: 'Failed to save MCP server' } });
	}
}

export async function deleteMCPServer(name: string, scope: string): Promise<void> {
	log.debug('SkillsPlugins', 'enter deleteMCPServer', { name, scope }, '➡️');
	try {
		const configPath = getMCPConfigPathForScope(scope);
		if (!configPath) {
			deps?.postMessage({ type: 'mcpServerError', data: { error: 'Config path not available' } });
			return;
		}

		const configUri = vscode.Uri.file(configPath);
		let fileConfig: any = {};

		try {
			const content = await vscode.workspace.fs.readFile(configUri);
			fileConfig = JSON.parse(new TextDecoder().decode(content));
		} catch {
			deps?.postMessage({ type: 'mcpServerError', data: { error: 'Config file not found' } });
			return;
		}

		if (fileConfig.mcpServers && fileConfig.mcpServers[name]) {
			delete fileConfig.mcpServers[name];
			const configContent = new TextEncoder().encode(JSON.stringify(fileConfig, null, 2));
			await vscode.workspace.fs.writeFile(configUri, configContent);
			deps?.postMessage({ type: 'mcpServerDeleted', data: { name } });
			log.debug('SkillsPlugins', 'exit deleteMCPServer — deleted', { name }, '⬅️');
		} else {
			log.debug('SkillsPlugins', 'exit deleteMCPServer — not found', { name }, '🚫');
			deps?.postMessage({ type: 'mcpServerError', data: { error: `Server '${name}' not found` } });
		}
	} catch (error: any) {
		log.error('SkillsPlugins', 'deleteMCPServer failed', { name, scope, error: error?.message ?? String(error) }, '💥');
		deps?.postMessage({ type: 'mcpServerError', data: { error: 'Failed to delete MCP server' } });
	}
}

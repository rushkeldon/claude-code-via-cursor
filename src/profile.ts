import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { log } from './logger';

type PostMessageFn = (message: any) => void;

let postMessage: PostMessageFn | undefined;
let profileDiagnosticShown = false;

export function init(deps: { postMessage: PostMessageFn }): void {
	log.info('Profile', 'init', { hasPostMessage: !!deps.postMessage }, '🔧');
	postMessage = deps.postMessage;
}

export function postIdentityProfile(profile: string | null, healthy: boolean): void {
	log.debug('Profile', 'enter postIdentityProfile', { profile, healthy }, '➡️');
	postMessage?.({
		type: 'identityProfile',
		data: { profile, healthy }
	});
	log.debug('Profile', 'exit postIdentityProfile', undefined, '⬅️');
}

export function readAndPushProfile(): void {
	log.debug('Profile', 'enter readAndPushProfile', undefined, '➡️');
	const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
	let profile: string | null = null;
	let healthy = false;
	let diagnostic = '';
	try {
		const raw = fs.readFileSync(settingsPath, 'utf8');
		const json = JSON.parse(raw);
		const p = json?.meta?.profileType;
		if (typeof p === 'string' && p.length > 0) {
			profile = p;
			log.debug('Profile', 'profileType found', { profile }, '✅');
		} else {
			diagnostic = 'Read ' + settingsPath + ' OK, but meta.profileType is ' + JSON.stringify(p) +
				'. Your claude login likely rewrote settings.json and stripped the annotation. ' +
				'Add it back with: edit ' + settingsPath + ' and set {"meta": {"profileType": "your-name"}, ...rest}.';
			log.debug('Profile', 'profileType missing or empty', { rawValue: p }, '🚫');
		}
		healthy = true;
	} catch (e) {
		healthy = false;
		diagnostic = 'Could not read ' + settingsPath + ': ' + ((e as any)?.message || 'unknown error');
		log.error('Profile', 'readAndPushProfile failed to read settings', { error: (e as any)?.message ?? String(e) }, '💥');
	}
	if (profile) {
		log.info('Profile', 'profile read', { profile, healthy }, '👤');
	} else {
		log.warn('Profile', 'profile read', { profile, healthy, diagnostic }, '👤');
	}
	postIdentityProfile(profile, healthy);
	if (!profile && diagnostic && !profileDiagnosticShown) {
		profileDiagnosticShown = true;
		postMessage?.({ type: 'profileDiagnostic', data: diagnostic });
		log.debug('Profile', 'posted profileDiagnostic to webview', undefined, '📨');
	}
	log.debug('Profile', 'exit readAndPushProfile', { profile, healthy }, '⬅️');
}

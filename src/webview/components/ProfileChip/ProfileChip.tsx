import './ProfileChip.less';
import { currentProfile, profileHealthy } from '../../state/profile';
import { post } from '../../vscode';

export function ProfileChip() {
  const profile = currentProfile.value;
  const healthy = profileHealthy.value;

  if (!profile && healthy) return null;

  let label: string;
  let title: string;
  let healthClass: string;

  if (profile) {
    label = profile;
    healthClass = healthy ? 'profile-chip--healthy' : 'profile-chip--unknown';
    title = `Profile: ${profile}${healthy ? '' : ' (settings.json unreadable)'} — click to switch`;
  } else if (healthy) {
    label = '(no profile)';
    healthClass = 'profile-chip--unknown';
    title = '~/.claude/settings.json has no meta.profileType — click to switch';
  } else {
    label = '?';
    healthClass = 'profile-chip--unknown';
    title = '~/.claude/settings.json unreadable — click to switch';
  }

  return (
    <button
      class={`profile-chip ${healthClass}`}
      type="button"
      title={title}
      onClick={() => post({ type: 'openProfileSwitcher' } as any)}
    >
      <span class="profile-chip-dot"></span>
      <span class="profile-chip-label">{label}</span>
    </button>
  );
}

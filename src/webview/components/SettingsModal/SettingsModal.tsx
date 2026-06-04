import './SettingsModal.less';
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { Modal } from '../Modal/Modal';
import { on, post } from '../../vscode';
import { fullSettings, permissionsData, detectedTerminals } from '../../state/settings';

export const settingsModalVisible = signal(false);

on('showSettings', () => { settingsModalVisible.value = true; });

const TOOL_OPTIONS = [
  'Bash', 'Read', 'Edit', 'Write', 'MultiEdit',
  'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch',
];

function updateSetting(key: string, value: any) {
  const current = fullSettings.value;
  if (!current) return;
  post({ type: 'updateSettings', settings: { [key]: value } });
}

function WSLSection() {
  const s = fullSettings.value;
  if (!s) return null;

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">WSL Configuration</h3>
      <p class="settings-hint">
        WSL integration allows you to run Claude Code from within Windows Subsystem for Linux.
      </p>
      <div class="settings-group">
        <label class="settings-checkbox">
          <input
            type="checkbox"
            checked={s['wsl.enabled']}
            onChange={(e) => updateSetting('wsl.enabled', (e.target as HTMLInputElement).checked)}
          />
          Enable WSL Integration
        </label>

        {s['wsl.enabled'] && (
          <div class="settings-sub-fields">
            <div class="settings-field">
              <label>WSL Distribution</label>
              <input
                type="text"
                value={s['wsl.distro']}
                placeholder="Ubuntu"
                onBlur={(e) => updateSetting('wsl.distro', (e.target as HTMLInputElement).value || 'Ubuntu')}
              />
            </div>
            <div class="settings-field">
              <label>Claude Path in WSL</label>
              <input
                type="text"
                value={s['wsl.claudePath']}
                placeholder="/usr/local/bin/claude"
                onBlur={(e) => updateSetting('wsl.claudePath', (e.target as HTMLInputElement).value || '/usr/local/bin/claude')}
              />
              <p class="settings-field-hint">
                Find your path by running: <code>which claude</code>
              </p>
            </div>
            <div class="settings-field">
              <label>Node.js Path in WSL (Optional)</label>
              <input
                type="text"
                value={s['wsl.nodePath']}
                placeholder="/usr/bin/node"
                onBlur={(e) => updateSetting('wsl.nodePath', (e.target as HTMLInputElement).value)}
              />
              <p class="settings-field-hint">
                Only needed if Claude was installed via npm.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionsSection() {
  const s = fullSettings.value;
  const perms = permissionsData.value;
  const [showAddForm, setShowAddForm] = useState(false);
  const [addTool, setAddTool] = useState('');
  const [addCommand, setAddCommand] = useState('');

  if (!s) return null;

  const entries = Object.entries(perms.alwaysAllow || {});

  function handleRemove(toolName: string, command: string | null) {
    post({ type: 'removePermission', toolName, command });
  }

  function handleAdd() {
    if (!addTool) return;
    const cmd = (addTool === 'Bash' && addCommand.trim()) ? addCommand.trim() : null;
    post({ type: 'addPermission', toolName: addTool, command: cmd });
    setAddTool('');
    setAddCommand('');
    setShowAddForm(false);
  }

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">Permissions</h3>
      <p class="settings-hint">
        Manage commands and tools that are automatically allowed without asking for permission.
      </p>
      <div class="settings-group">
        <div class="permissions-list">
          {entries.length === 0 && (
            <div class="permissions-empty">No always-allow permissions set</div>
          )}
          {entries.map(([tool, value]) => {
            if (value === true) {
              return (
                <div class="permission-item" key={tool}>
                  <span class="permission-tool">{tool}</span>
                  <span class="permission-value">All</span>
                  <button class="permission-remove" onClick={() => handleRemove(tool, null)}>✕</button>
                </div>
              );
            }
            if (Array.isArray(value)) {
              return value.map((cmd) => (
                <div class="permission-item" key={`${tool}-${cmd}`}>
                  <span class="permission-tool">{tool}</span>
                  <span class="permission-value">{cmd}</span>
                  <button class="permission-remove" onClick={() => handleRemove(tool, cmd)}>✕</button>
                </div>
              ));
            }
            return null;
          })}
        </div>

        {showAddForm ? (
          <div class="permissions-add-form">
            <div class="permissions-form-row">
              <select value={addTool} onChange={(e) => setAddTool((e.target as HTMLSelectElement).value)}>
                <option value="">Select tool...</option>
                {TOOL_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {addTool === 'Bash' && (
                <input
                  type="text"
                  placeholder="Command pattern (e.g., npm i *)"
                  value={addCommand}
                  onInput={(e) => setAddCommand((e.target as HTMLInputElement).value)}
                />
              )}
              <button class="btn" onClick={handleAdd}>Add</button>
            </div>
            <button class="btn-link" onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
        ) : (
          <button class="btn-link" onClick={() => setShowAddForm(true)}>+ Add permission</button>
        )}

        <div class="yolo-mode-section">
          <label class="settings-checkbox">
            <input
              type="checkbox"
              checked={s['permissions.yoloMode']}
              onChange={(e) => updateSetting('permissions.yoloMode', (e.target as HTMLInputElement).checked)}
            />
            Enable Yolo Mode (Auto-allow all permissions)
          </label>
        </div>
      </div>
    </div>
  );
}

function EnvVariablesEditor() {
  const s = fullSettings.value;
  if (!s) return null;

  const envVars = s['environment.variables'] || {};
  const entries = Object.entries(envVars);
  if (entries.length === 0) entries.push(['', '']);

  function commitEnvVars(updatedEntries: [string, string][]) {
    const result: Record<string, string> = {};
    for (const [k, v] of updatedEntries) {
      if (k.trim()) result[k.trim()] = v;
    }
    updateSetting('environment.variables', result);
  }

  function handleKeyBlur(idx: number, newKey: string) {
    const updated = [...entries] as [string, string][];
    updated[idx] = [newKey, updated[idx][1]];
    commitEnvVars(updated);
  }

  function handleValueBlur(idx: number, newValue: string) {
    const updated = [...entries] as [string, string][];
    updated[idx] = [updated[idx][0], newValue];
    commitEnvVars(updated);
  }

  function handleRemoveRow(idx: number) {
    const updated = entries.filter((_, i) => i !== idx) as [string, string][];
    commitEnvVars(updated);
  }

  function handleAddRow() {
    const updated = [...entries, ['', '']] as [string, string][];
    commitEnvVars(updated);
  }

  return (
    <div class="env-editor">
      <label class="settings-field-label">Environment Variables</label>
      {entries.map(([key, value], idx) => (
        <div class="env-row" key={idx}>
          <input
            type="text"
            class="env-key"
            placeholder="KEY"
            value={key}
            onBlur={(e) => handleKeyBlur(idx, (e.target as HTMLInputElement).value)}
          />
          <input
            type="text"
            class="env-value"
            placeholder="value"
            value={value}
            onBlur={(e) => handleValueBlur(idx, (e.target as HTMLInputElement).value)}
          />
          <button class="env-remove" onClick={() => handleRemoveRow(idx)}>✕</button>
        </div>
      ))}
      <button class="btn-link" onClick={handleAddRow}>+ Add Variable</button>
    </div>
  );
}

function CustomizeSection() {
  const s = fullSettings.value;
  if (!s) return null;

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">Customize Claude Command</h3>
      <p class="settings-hint">
        Customize the Claude Code executable and environment.
      </p>
      <div class="settings-group">
        <div class="settings-field">
          <label>Executable Path</label>
          <input
            type="text"
            value={s['executable.path']}
            placeholder="claude (default)"
            onBlur={(e) => updateSetting('executable.path', (e.target as HTMLInputElement).value)}
          />
          <p class="settings-field-hint">
            Custom path to the Claude Code executable. Leave empty to use the default <code>claude</code> command.
          </p>
        </div>
        <EnvVariablesEditor />
      </div>
    </div>
  );
}

const skillsStatus = signal<{ modesInstalled: boolean; plan2cursorInstalled: boolean } | null>(null);

on('skillsStatus' as any, (msg: any) => {
  skillsStatus.value = msg.data;
});

function FirstRunSection() {
  function resetFirstRun() {
    post({ type: 'resetFirstRun' } as any);
  }

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">First-Run Experience</h3>
      <p class="settings-hint">
        Re-show the welcome screen on next launch.
      </p>
      <div class="settings-group">
        <button class="btn-link" onClick={resetFirstRun}>Reset First-Run</button>
      </div>
    </div>
  );
}

function SkillsSection() {
  const status = skillsStatus.value;

  function checkStatus() {
    post({ type: 'checkSkillsInstalled' } as any);
  }

  function installSkills() {
    post({ type: 'installRecommendedSkills' } as any);
  }

  if (!status) {
    checkStatus();
    return (
      <div class="settings-section">
        <h3 class="settings-section-title">Skills</h3>
        <p class="settings-hint">Checking installed skills...</p>
      </div>
    );
  }

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">Skills</h3>
      <p class="settings-hint">
        Recommended skills for this extension.
      </p>
      <div class="settings-group">
        <div class="permission-item">
          <span class="permission-tool">modes</span>
          <span class="permission-value">Persistent response modes (plan, agent, sbs, etc.)</span>
          {status.modesInstalled
            ? <span style="color: var(--vscode-charts-green, #4ec9b0);">✓</span>
            : <button class="btn-link" onClick={installSkills}>Install</button>}
        </div>
        <div class="permission-item">
          <span class="permission-tool">plan2cursor</span>
          <span class="permission-value">Send plans to Cursor's plans panel</span>
          {status.plan2cursorInstalled
            ? <span style="color: var(--vscode-charts-green, #4ec9b0);">✓</span>
            : <button class="btn-link" onClick={installSkills}>Install</button>}
        </div>
      </div>
    </div>
  );
}

const OTHER_TERMINAL = '__other__';

function TerminalSection() {
  const s = fullSettings.value;
  const detected = detectedTerminals.value;
  if (!s) return null;

  if (!detected) {
    post({ type: 'getDetectedTerminals' } as any);
  }

  const useIntegrated = s['terminal.useIntegrated'];
  const externalApp = s['terminal.externalApp'];
  const terminals = detected?.terminals ?? [];
  // If a previously-chosen terminal is no longer detected, keep it selectable
  // so the user's stored choice isn't silently dropped.
  const isCustom = externalApp === OTHER_TERMINAL ||
    (!!externalApp && externalApp !== '' && !terminals.includes(externalApp) && externalApp !== OTHER_TERMINAL);

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">Terminal</h3>
      <p class="settings-hint">
        Where slash commands and breakout sessions run. Uncheck to launch an external terminal app instead of Cursor's integrated one.
      </p>
      <div class="settings-group">
        <label class="settings-checkbox">
          <input
            type="checkbox"
            checked={useIntegrated}
            onChange={(e) => updateSetting('terminal.useIntegrated', (e.target as HTMLInputElement).checked)}
          />
          Use integrated terminal
        </label>

        {!useIntegrated && (
          <div class="settings-sub-fields">
            <div class="settings-field">
              <label>External terminal</label>
              <select
                value={isCustom ? OTHER_TERMINAL : externalApp}
                onChange={(e) => updateSetting('terminal.externalApp', (e.target as HTMLSelectElement).value)}
              >
                <option value="" disabled>{detected ? 'Select a terminal…' : 'Detecting…'}</option>
                {terminals.map((t) => <option value={t}>{t}</option>)}
                <option value={OTHER_TERMINAL}>Other…</option>
              </select>
            </div>

            {isCustom && (
              <div class="settings-field">
                <label>Custom launch command</label>
                <input
                  type="text"
                  value={s['terminal.customTemplate']}
                  placeholder="open -a kitty --args bash -c {{command}}"
                  onBlur={(e) => updateSetting('terminal.customTemplate', (e.target as HTMLInputElement).value)}
                />
                <p class="settings-field-hint">
                  Shell command run to launch your terminal. Use <code>{'{{command}}'}</code> where the
                  Claude command should be inserted — e.g. <code>open -a kitty --args bash -c {'{{command}}'}</code>.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsModal() {
  return (
    <Modal
      title="Claude Code via Cursor — Settings"
      visible={settingsModalVisible.value}
      onClose={() => { settingsModalVisible.value = false; }}
    >
      {fullSettings.value ? (
        <div class="settings-modal-content">
          <WSLSection />
          <TerminalSection />
          <PermissionsSection />
          <SkillsSection />
          <FirstRunSection />
          <CustomizeSection />
        </div>
      ) : (
        <p class="settings-loading">Loading settings...</p>
      )}
    </Modal>
  );
}

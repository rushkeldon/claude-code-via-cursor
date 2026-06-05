import './PermissionRequest.less';
import { signal } from '@preact/signals';
import { on, post } from '../../vscode';
import { messages, PermissionData } from '../../state/messages';

interface PermissionRequestData {
  id: string;
  tool: string;
  input: Record<string, any>;
  pattern?: string;
  suggestions?: any[];
  decisionReason?: any;
  blockedPath?: any;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
}

export const pendingPermissions = signal<PermissionRequestData[]>([]);

function commitToMessages(data: PermissionRequestData) {
  const permissionData: PermissionData = {
    id: data.id,
    tool: data.tool,
    input: data.input,
    pattern: data.pattern,
    status: data.status as 'approved' | 'denied' | 'expired' | 'cancelled',
  };
  messages.value = [...messages.value, {
    role: 'permission',
    content: '',
    permissionData,
    timestamp: Date.now(),
  }];
}

on('permissionRequest', (msg) => {
  const data = msg.data as PermissionRequestData;
  if (data.status === 'pending') {
    pendingPermissions.value = [...pendingPermissions.value, data];
  } else {
    commitToMessages(data);
  }
});

on('updatePermissionStatus', (msg) => {
  const { id, status } = msg.data;
  if (status !== 'pending') {
    const p = pendingPermissions.value.find(p => p.id === id);
    if (p) {
      pendingPermissions.value = pendingPermissions.value.filter(p => p.id !== id);
      commitToMessages({ ...p, status });
    }
  }
});

on('expirePendingPermissions' as any, () => {
  const pending = pendingPermissions.value;
  if (pending.length > 0) {
    pendingPermissions.value = [];
    pending.forEach(p => commitToMessages({ ...p, status: 'expired' }));
  }
});

on('ready', () => {
  pendingPermissions.value = [];
});

on('newSession' as any, () => {
  pendingPermissions.value = [];
});

function respond(id: string, approved: boolean, alwaysAllow?: boolean) {
  post({ type: 'permissionResponse', id, approved, alwaysAllow });
  const p = pendingPermissions.value.find(p => p.id === id);
  if (p) {
    pendingPermissions.value = pendingPermissions.value.filter(p => p.id !== id);
    commitToMessages({ ...p, status: approved ? 'approved' : 'denied' });
  }
}

// Pull a human-readable summary of the tool call out of the raw input — the
// bash command for Bash, the file path for file tools, else a compact JSON.
function describeInput(tool: string, input: Record<string, any>): string {
  if (tool === 'Bash' && input?.command) return String(input.command);
  if (input?.file_path) return String(input.file_path);
  if (input?.path) return String(input.path);
  if (input && Object.keys(input).length > 0) {
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return '';
    }
  }
  return '';
}

interface PermissionCardProps {
  data: PermissionRequestData;
  isResolved?: boolean;
}

export function PermissionCard({ data, isResolved }: PermissionCardProps) {
  const resolved =
    isResolved ??
    (data.status === 'approved' ||
      data.status === 'denied' ||
      data.status === 'expired' ||
      data.status === 'cancelled');

  const isExitPlan = data.tool === 'ExitPlanMode';
  const toolName = isExitPlan ? 'Approve Plan' : data.tool;
  const detail = describeInput(data.tool, data.input);

  // For Bash, the "always allow" button offers the matched command pattern
  // (e.g. "npm install") rather than a blanket Bash allow.
  let alwaysAllowLabel = `Always allow ${toolName}`;
  if (data.tool === 'Bash' && data.pattern) {
    const display = data.pattern.replace(' *', '');
    const truncated = display.length > 30 ? display.slice(0, 30) + '…' : display;
    alwaysAllowLabel = `Always allow ${truncated}`;
  }

  return (
    <div class={`permission-request${resolved ? ' decided' : ''}`}>
      <div class="permission-header">
        <span class="permission-icon">🔐</span>
        <span>Permission Required</span>
      </div>
      <div class="permission-content">
        <p class="permission-prompt">
          {isExitPlan
            ? 'Approve the plan above?'
            : <>Allow <strong>{toolName}</strong> to run?</>}
        </p>
        {detail && <pre class="permission-detail">{detail}</pre>}
        {!resolved && (
          <div class="permission-buttons">
            <button class="btn deny" type="button" onClick={() => respond(data.id, false)}>Deny</button>
            {!isExitPlan && (
              <button class="btn always-allow" type="button" onClick={() => respond(data.id, true, true)}>{alwaysAllowLabel}</button>
            )}
            <button class="btn allow primary" type="button" onClick={() => respond(data.id, true)}>{isExitPlan ? 'Approve' : 'Allow'}</button>
          </div>
        )}
        {data.status === 'approved' && (
          <div class="permission-decision allowed">✅ You allowed this</div>
        )}
        {data.status === 'denied' && (
          <div class="permission-decision denied">❌ You denied this</div>
        )}
        {(data.status === 'expired' || data.status === 'cancelled') && (
          <div class="permission-decision expired">⏱️ This request expired</div>
        )}
      </div>
    </div>
  );
}

export function PendingPermissions() {
  if (pendingPermissions.value.length === 0) return null;
  return (
    <>
      {pendingPermissions.value.map(p => <PermissionCard key={p.id} data={p} />)}
    </>
  );
}

export function InlinePermissionCard({ permissionData }: { permissionData: PermissionData }) {
  const asData: PermissionRequestData = {
    id: permissionData.id,
    tool: permissionData.tool,
    input: permissionData.input,
    pattern: permissionData.pattern,
    status: permissionData.status,
  };
  return <PermissionCard data={asData} isResolved={true} />;
}

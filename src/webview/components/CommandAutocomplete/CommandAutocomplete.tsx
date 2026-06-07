import './CommandAutocomplete.less';
import { CommandInfo } from '../../state/commands';

interface CommandAutocompleteProps {
  commands: CommandInfo[];
  filter: string;
  onSelect: (command: CommandInfo) => void;
}

export function CommandAutocomplete({ commands, filter, onSelect }: CommandAutocompleteProps) {
  const term = filter.replace(/^\//, '').toLowerCase();

  // The command list is populated by the initialize handshake, which only
  // completes after the subprocess spawns (on a cold session that's not until
  // the first turn, and the Bedrock handshake can take ~15-20s). If we open the
  // palette before it arrives, show a loading row instead of a dead/empty
  // dropdown — the list signal updates live when postCommandList() fires, so
  // this self-heals into the real list with no further action.
  if (commands.length === 0) {
    return (
      <div class="command-autocomplete">
        <div class="command-autocomplete-loading">Loading commands…</div>
      </div>
    );
  }

  const prefix = commands.filter(c => c.name.toLowerCase().startsWith(term));
  const fuzzy = commands.filter(c =>
    c.name.toLowerCase().includes(term) && !c.name.toLowerCase().startsWith(term)
  );
  const filtered = [...prefix, ...fuzzy];

  if (filtered.length === 0) return null;

  return (
    <div class="command-autocomplete">
      {filtered.map((cmd) => (
        <button
          key={cmd.name}
          class="command-autocomplete-item"
          type="button"
          onClick={() => onSelect(cmd)}
        >
          <span class="command-autocomplete-name">
            /{cmd.name}
            {cmd.argumentHint && (
              <span class="command-autocomplete-args"> {cmd.argumentHint}</span>
            )}
          </span>
          <span class="command-autocomplete-desc">{cmd.description}</span>
          {cmd.aliases && cmd.aliases.length > 0 && (
            <span class="command-autocomplete-aliases">
              {cmd.aliases.map((a) => `/${a}`).join(' ')}
            </span>
          )}
          {cmd.type === 'skill' && <span class="command-autocomplete-badge">skill</span>}
        </button>
      ))}
    </div>
  );
}

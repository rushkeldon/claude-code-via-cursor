import './CommandAutocomplete.less';
import { CommandInfo } from '../../state/commands';

interface CommandAutocompleteProps {
  commands: CommandInfo[];
  filter: string;
  onSelect: (command: CommandInfo) => void;
}

export function CommandAutocomplete({ commands, filter, onSelect }: CommandAutocompleteProps) {
  const term = filter.replace(/^\//, '').toLowerCase();

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
          <span class="command-autocomplete-name">/{cmd.name}</span>
          <span class="command-autocomplete-desc">{cmd.description}</span>
          {cmd.type === 'skill' && <span class="command-autocomplete-badge">skill</span>}
        </button>
      ))}
    </div>
  );
}

// Per-category tool icons. Each tool name maps to a category; the category
// drives the icon box's CSS class (`tool-icon--<category>`), which in
// ToolMessage.less sets a white SVG (data-URI background) over a distinct
// linear-gradient — same pattern as the original .tool-icon.
//
// To customize an icon: replace the placeholder white-circle data-URI in
// ToolMessage.less for that category with the real white SVG. The SVGs are
// intentionally white (fill='%23fff'); differentiation comes from the gradient.
//
// MCP tools arrive as `mcp__<server>__<tool>` — matched by prefix. Anything
// unrecognized falls back to 'generic' so a new/unknown tool never renders blank.

export type ToolCategory =
  | 'read'
  | 'mutate'
  | 'search'
  | 'execute'
  | 'web'
  | 'agentic'
  | 'mcp'
  | 'generic';

// Exact tool-name → category. Names are the raw Claude Code tool identifiers.
const TOOL_CATEGORY: Record<string, ToolCategory> = {
  // Read
  Read: 'read',
  NotebookRead: 'read',
  // Mutate (write/edit)
  Write: 'mutate',
  Edit: 'mutate',
  MultiEdit: 'mutate',
  NotebookEdit: 'mutate',
  // Search / navigation
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  // Execution
  Bash: 'execute',
  BashOutput: 'execute',
  KillBash: 'execute',
  KillShell: 'execute',
  // Web
  WebFetch: 'web',
  WebSearch: 'web',
  // Agentic / meta
  Task: 'agentic',
  TodoWrite: 'agentic',
  ExitPlanMode: 'agentic',
};

// Resolve a tool name to its category. MCP tools (mcp__server__tool) and any
// unmapped name degrade gracefully.
export function toolCategory(toolName: string | undefined): ToolCategory {
  if (!toolName) return 'generic';
  if (toolName.startsWith('mcp__')) return 'mcp';
  return TOOL_CATEGORY[toolName] ?? 'generic';
}

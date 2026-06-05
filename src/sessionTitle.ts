// Session-title generation helpers.
//
// The History list shows a short, descriptive title per conversation instead of
// the verbatim first user message. The title is produced by the live model via
// a *silent* query (subprocess.sendSilentQuery) on a 3-then-6 user-turn
// schedule, so the model has real conversation context to name it well.
//
// This module is intentionally dependency-free (no imports of subprocess /
// conversation) so it can be imported from either without a cycle. It owns only
// the prompt text and the answer sanitizer.

// The prompt sent as a silent query. The "reply with only the title" + format
// constraints are load-bearing: without them the model answers conversationally
// ("Sure, I'd call this…") and the answer needs heavy stripping.
export const TITLE_PROMPT =
	"Quick side question, unrelated to the task at hand: I'm assembling a list of " +
	'past conversations and need a short working title for this one. Knowing what ' +
	"we've covered so far, what would you call it? Reply with only the title — " +
	'about 3 to 6 words, descriptive enough to tell it apart from other chats, ' +
	'with no surrounding quotes and no trailing punctuation.';

// Maximum stored title length (matches the index field clamp).
const MAX_TITLE_LEN = 80;

// Turn a raw model answer into a clean one-line title, or '' if unusable.
// Strips wrapping quotes, leading conversational filler, markdown, trailing
// punctuation; collapses whitespace; clamps length. Callers must treat '' as
// "keep the existing title" — never overwrite a good title with garbage.
export function sanitizeTitle(raw: string): string {
	if (!raw) { return ''; }

	let t = raw.trim();

	// Collapse any internal newlines/whitespace runs to single spaces.
	t = t.replace(/\s+/g, ' ').trim();

	// Drop common conversational lead-ins the constraints usually prevent but
	// don't always ("Sure, I'd call this", "Title:", "I'd name it", etc.).
	t = t.replace(/^(sure|okay|ok|certainly|here(?:'s| is)?|i(?:'d| would)?\s*(?:call|name|title)\s*(?:it|this)?|title|working title)\b[:,]?\s*/i, '');

	// Strip a single pair of wrapping quotes (straight or curly) or backticks.
	t = t.replace(/^["'`“”‘’]+/, '').replace(/["'`“”‘’]+$/, '').trim();

	// Strip trailing sentence punctuation.
	t = t.replace(/[.!?,;:]+$/, '').trim();

	if (!t) { return ''; }

	if (t.length > MAX_TITLE_LEN) {
		t = t.substring(0, MAX_TITLE_LEN).trim();
	}

	return t;
}

// Curated capability ladder for the difficulty→model suggestion.
//
// IMPORTANT: this is NOT the model picker's display list. That list (modelList)
// interleaves legacy versions (Opus 4.7/4.6) and 1M-context variants, so a raw
// "score → Nth row" would land on a legacy/long-context row that isn't a clean
// capability step. This ladder is a small, deliberate sequence of CURRENT,
// non-legacy models in ascending capability, which a difficulty score (1-10 for
// the average HUMAN software engineer) indexes into. When the model lineup
// changes, update THIS array, not the mapping logic.
//
// Ascending difficulty → ascending capability. Each entry is a model id the
// extension can pass to a subagent / inline command.

export interface LadderRung {
  id: string;
  label: string;
}

export const MODEL_LADDER: LadderRung[] = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-fable-5', label: 'Fable 5' },
];

// Map a 1-10 difficulty score onto a ladder rung. Buckets are deliberately coarse
// and human-anchored: trivial work → cheapest capable tier; genuinely hard /
// no-clear-idiom work → the top tier. Tunable here without touching callers.
//   1-3  → Haiku   (trivial: renames, string changes, well-worn patterns)
//   4-6  → Sonnet  (solid mid-level feature with a clear pattern to follow)
//   7-8  → Opus    (cross-cutting, subtle, needs real reasoning)
//   9-10 → Fable   (novel design, shifting idiom, hardest tasks)
export function ladderModelForDifficulty(score: number): string {
  const s = Math.max(1, Math.min(10, Math.round(score)));
  if (s <= 3) return MODEL_LADDER[0].id;
  if (s <= 6) return MODEL_LADDER[1].id;
  if (s <= 8) return MODEL_LADDER[2].id;
  return MODEL_LADDER[3].id;
}

// The default suggestion when no difficulty score is available yet (the live
// rating turn is a deferred follow-up — see the difficulty-rating todo). We seed
// the MID tier (Sonnet) as a neutral, sensible implementer default rather than
// pretending to a rating we don't have. The user overrides freely (the list is
// right there). This keeps the "suggested" radio meaningful without false
// authority.
export const DEFAULT_SUGGESTED_MODEL = MODEL_LADDER[1].id;

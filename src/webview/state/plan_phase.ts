import { signal, effect } from '@preact/signals';
import { on } from '../vscode';
import { activeMode } from './settings';

// Plan-phase picker state — the second pill that shows right of the Agent/Plan
// pill while in Plan mode. EPHEMERAL by design: this is in-memory only, rebuilt
// every session, NEVER written to active_modes.md or any file. (Contrast the
// plan-handoff table, which is the one thing that DOES persist.)
//
// It is a PICKER, not a live indicator: the only automatic behavior is seeding
// 'collaborate' when Plan mode turns on. State flows one way — the user picks a
// phase → an action fires — so there is no fragile NL-intent detection.
//
// 'collaborate' is the named DEFAULT/baseline (collaborate : Plan :: agent :
// modes) — the resting state of being in Plan mode, not an action. The other six
// are deliberate actions the user escalates to.

export type PlanPhase =
  | 'collaborate'
  | 'write'
  | 'review'
  | 'verify'
  | 'update'
  | 'build'
  | 'toIDE';

// The phases that, when picked, open a dialogue (vs. 'collaborate' which is the
// inert baseline). Drives the trailing-ellipsis affordance in the picker.
export const DIALOGUE_PHASES: PlanPhase[] = [
  'write',
  'review',
  'verify',
  'update',
  'build',
  'toIDE',
];

// The currently selected phase for the session. Resets to 'collaborate'.
export const planPhase = signal<PlanPhase>('collaborate');

// Which phase dialogue is currently open (null = none). The phase picker sets
// this when a dialogue-spawning phase is chosen; the dialogue components
// (which-plan / write / review-build) render off it and clear it on close/commit.
// 'collaborate' never opens a dialogue, so it's not a valid value here.
export const activePhaseDialog = signal<Exclude<PlanPhase, 'collaborate'> | null>(null);

// Plan candidates for the which-plan picker, mirrored from the host's planList
// (whole-workspace *.plan.md, recently-changed first, archived decoys suppressed,
// live ~/.cursor/plans copies appended). Requested when a dialogue opens.
export interface PlanCandidate {
  path: string;
  label: string;
  location: 'project' | 'cursor';
}
export const planList = signal<PlanCandidate[]>([]);

// The model the difficulty rating suggests for review/build (pre-scroll target in
// the dialogue). null until a rating has been computed for the open dialogue.
export const suggestedModel = signal<string | null>(null);

on('planList' as any, (msg: any) => {
  const plans = msg?.data?.plans;
  planList.value = Array.isArray(plans) ? plans : [];
});

// Per-plan phase registry: you routinely have 1-3 plans in flight, and phase is
// a property OF a plan, not of the session. Keyed by resolved plan path. Reading
// the picker for a given plan falls back to 'collaborate' when unseen. Ephemeral.
export const planPhaseByPlan = signal<Record<string, PlanPhase>>({});

export function setPhaseForPlan(planPath: string, phase: PlanPhase): void {
  planPhaseByPlan.value = { ...planPhaseByPlan.value, [planPath]: phase };
  planPhase.value = phase;
}

// Seed 'collaborate' on each ENTRY into Plan mode, and reset on leaving. Using an
// effect keeps this in lockstep with the real activeMode signal (which reflects
// the host's active_modes.md). We track the previous mode locally so the effect
// depends ONLY on activeMode — it must not read planPhase.value, or it would
// subscribe to it and clobber the user's pick on every selection. peek() reads
// without subscribing; we only WRITE planPhase on an actual mode transition.
let prevMode: 'agent' | 'plan' | undefined;
effect(() => {
  const mode = activeMode.value; // the sole dependency
  if (mode !== prevMode) {
    // Transition: entering plan → seed baseline; leaving plan → reset baseline.
    planPhase.value = 'collaborate';
    prevMode = mode;
  }
});

// Fresh webview / new session → wipe back to baseline (mirrors queue.ts).
on('ready', () => {
  planPhase.value = 'collaborate';
  planPhaseByPlan.value = {};
});

on('newSession' as any, () => {
  planPhase.value = 'collaborate';
  planPhaseByPlan.value = {};
});

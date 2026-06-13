import "../AskUserQuestion/AskUserQuestion.less";
import "./PlanPhaseDialog.less";
import { useState, useEffect } from "preact/hooks";
import { post } from "../../vscode";
import { modelList, fullSettings } from "../../state/settings";
import {
  activePhaseDialog,
  planList,
  setPhaseForPlan,
  suggestedModel,
  type PlanPhase,
} from "../../state/plan_phase";
import { DEFAULT_SUGGESTED_MODEL } from "../../state/model_ladder";

// The CCVI Q & A card — a USER-initiated planning dialogue. It shares
// AskUserQuestion's STYLES (visual consistency, collapses into chat history) but
// NOT its agent-tool-call plumbing: there is no blocked agent / requestId. On
// commit it yields a STRUCTURED result (plan path, model id) and emits the real
// /plans verb (or an NL prompt) via the safe send path — so the user learns the
// verb (train-the-human) and nothing is sent by simulated typing (the 188
// truncation class is avoided; we post the full string directly).
//
// Option grammar: N concrete radios + an `other…` radio that reveals a richer
// control (an editable path field, or the full model list). The common case is
// one click; the escape hatch is always present (current-not-fence).

const OTHER = "__other__";

// Send a full command/prompt string DIRECTLY (never via the textarea) so a path
// argument can't be truncated. Routed as a normal sendMessage; the host renders
// CCVI-authored turns under the CCVI card (the card type already exists).
function sendCommand(text: string) {
  // planMode:false — these are explicit slash commands / NL prompts, not the
  // mode-toggle flag. ccvc:true tags the turn so the host renders it as a CCVI
  // card (extension-authored, neither YOU nor Claude).
  post({ type: "sendMessage", text, planMode: false, ccvc: true } as any);
}

// Build the natural-language delegation prompt for the model-breakout path. The
// IN-SESSION agent reads this and spawns a fresh-context subagent AT THE CHOSEN
// MODEL to run the verb — the extension never spawns anything. The prompt asks
// for the result (report path + one-line gestalt) to come back to the
// conversation, which is how review-return happens: the subagent's outcome is
// just the in-session agent's normal turn output. Whether the wrapped CLI
// actually honors a model-overridden subagent is the open behavioral question
// (the spike) — this wires the request the correct way regardless.
function delegatePrompt(verb: "review" | "build", planPath: string, model: string): string {
  if (verb === "review") {
    return (
      `Spawn a fresh-context subagent using model \`${model}\` to run ` +
      `\`/plans review ${planPath}\` (review it as the prospective implementer — ` +
      `can you build this with no open questions?). When it finishes, report back ` +
      `the written report path and a one-line verdict gestalt.`
    );
  }
  return (
    `Spawn a fresh-context subagent using model \`${model}\` to run ` +
    `\`/plans build ${planPath}\` — execute the plan, flipping its todos live. ` +
    `When it finishes, report back a one-line summary of what landed.`
  );
}

function phaseTitle(phase: PlanPhase): string {
  // Returns the verb phrase that completes "Which plan do you want to ___?"
  switch (phase) {
    case "write": return "write";
    case "review": return "review";
    case "verify": return "verify";
    case "update": return "update from a report";
    case "build": return "build";
    case "toIDE": return "send to IDE";
    default: return "";
  }
}

export function PlanPhaseDialog() {
  const phase = activePhaseDialog.value;

  // Local control state — reset whenever the open dialogue changes.
  const [planChoice, setPlanChoice] = useState<string>("");
  const [planOther, setPlanOther] = useState<string>(""); // typed full path (other…)
  const [planSelect, setPlanSelect] = useState<string>(""); // picked from the overflow <select> (other…)
  const [modelChoice, setModelChoice] = useState<string>("session"); // 'session' | model-id | OTHER
  const [modelOther, setModelOther] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [selectedKey, setSelectedKey] = useState<string>("cursor"); // toIDE editor-registry key
  const [reportPath, setReportPath] = useState<string>("");

  // On open: request a fresh plan list, seed defaults. (Hooks must be
  // unconditional — we gate on `phase` INSIDE the effect, not around the hook.)
  useEffect(() => {
    if (!phase) return;
    post({ type: "getPlanList" } as any);
    setPlanChoice("");
    setPlanOther("");
    setPlanSelect("");
    setModelChoice("session");
    setModelOther("");
    setName("");
    // Default the editor picker to the first registry row, preferring 'cursor' if
    // present (its ~/.cursor/plans dir is the out-of-repo handoff case).
    {
      const editors = fullSettings.value?.["plans.editors"] ?? [];
      const hasCursor = editors.some((e) => e.key === "cursor");
      setSelectedKey(hasCursor ? "cursor" : (editors[0]?.key ?? "cursor"));
    }
    setReportPath("");
    // Seed the suggested-model pre-scroll. Until a live difficulty-rating turn is
    // wired (deferred — see plan), this is the neutral mid-tier default rather
    // than a rating we don't have. User overrides freely via "other…".
    suggestedModel.value = DEFAULT_SUGGESTED_MODEL;
  }, [phase]);

  if (!phase) return null;

  const plans = planList.value;
  const needsPlan = phase !== "write"; // write CREATES a plan; others pick one
  const needsModel = phase === "review" || phase === "build";
  const suggested = suggestedModel.value; // pre-scroll target from difficulty rating

  // planList arrives recently-changed-first (host sorts by mtime). Show the top 3
  // as radios; the rest go behind an `other…` <select> so the dialog stays small
  // even with many plans in scope (the bug: every plan rendered as a radio).
  const top3 = plans.slice(0, 3);
  const rest = plans.slice(3);

  // Resolve the chosen plan path. `other…` resolves to the typed full path if
  // present, else the <select> pick. A concrete radio resolves to itself.
  const resolvedPlan =
    planChoice === OTHER
      ? (planOther.trim() || planSelect)
      : planChoice;

  function close() {
    activePhaseDialog.value = null;
  }

  function commit() {
    const p = resolvedPlan;
    switch (phase) {
      case "write": {
        const dir = "doc"; // plan dir; NL prompt names the file explicitly
        const fname = (name.trim() || "untitled").replace(/\.plan\.md$/, "");
        sendCommand(
          `Write the plan we've discussed to ${dir}/${fname}.plan.md — follow the plan format and the plan-write discipline.`,
        );
        break;
      }
      case "verify":
        if (!p) return;
        sendCommand(`/plans verify ${p}`);
        break;
      case "update":
        if (!p) return;
        sendCommand(`/plans update ${p}${reportPath.trim() ? " " + reportPath.trim() : ""}`);
        break;
      case "toIDE": {
        if (!p) return;
        // Record the alias row BEFORE sending — but ONLY for the 'cursor' key, the
        // lone out-of-repo destination that produces a decoy the picker must
        // suppress. Other keys (code/idea/custom) copy in-repo or open in place,
        // where sendPlanList already globs them, so they need no handoff row.
        const editors = fullSettings.value?.["plans.editors"] ?? [];
        if (selectedKey === "cursor") {
          // Compute the source-of-truth from the cursor row's CONFIGURED dir (not a
          // hardcoded literal) so a customized cursor dir still aliases correctly.
          const cursorRow = editors.find((e) => e.key === "cursor");
          const dir = (cursorRow?.directory ?? "~/.cursor/plans").replace(/\/+$/, "");
          const base = p.split("/").pop() || p;
          post({
            type: "recordPlanHandoff",
            originalPlanFile: p,
            sourceOfTruthPlanFile: `${dir}/${base}`,
          } as any);
        }
        sendCommand(`/plans toIDE ${p} ${selectedKey}`);
        break;
      }
      case "build": {
        if (!p) return;
        if (modelChoice === "session") {
          // In-session: exit plan mode (visible) then build, two lines.
          sendCommand(`/modes agent\n/plans build ${p}`);
        } else {
          // Delegate to a fresh-context subagent at the chosen model — the
          // IN-SESSION agent spawns it via NL (not the extension spawning a
          // subprocess). In-band, human-initiated (this click).
          const model = modelChoice === OTHER ? modelOther.trim() : modelChoice;
          sendCommand(delegatePrompt("build", p, model));
        }
        break;
      }
      case "review": {
        if (!p) return;
        if (modelChoice === "session") {
          sendCommand(`/plans review ${p}`);
        } else {
          const model = modelChoice === OTHER ? modelOther.trim() : modelChoice;
          sendCommand(delegatePrompt("review", p, model));
        }
        break;
      }
    }
    if (p) setPhaseForPlan(p, phase);
    close();
  }

  // Commit is allowed once the dialogue has what it minimally needs.
  const canCommit =
    phase === "write" ? name.trim().length > 0 : resolvedPlan.length > 0;

  return (
    <div class="ask-user-question ccvc-qa">
      <div class="ask-question-header">
        <span>CCVI Q &amp; A</span>
        <span class="ask-question-status">{phase}</span>
      </div>
      <div class="ask-question-content">
        {/* ── which plan ─────────────────────────────────────────────── */}
        {needsPlan && (
          <div class="question-block">
            <div class="question-block-header">Plan</div>
            <div class="question-text">Which plan do you want to {phaseTitle(phase)}?</div>
            <div class="question-options">
              {top3.map((pl) => (
                <label class="question-option" key={pl.path}>
                  <input
                    type="radio"
                    name="plan-pick"
                    checked={planChoice === pl.path}
                    onChange={() => setPlanChoice(pl.path)}
                  />
                  <div class="option-content">
                    <span class="option-label">{pl.label}</span>
                    <span class="option-description">
                      {pl.location === "cursor" ? "in Cursor · " : ""}
                      {pl.path}
                    </span>
                  </div>
                </label>
              ))}
              <label class="question-option">
                <input
                  type="radio"
                  name="plan-pick"
                  checked={planChoice === OTHER}
                  onChange={() => setPlanChoice(OTHER)}
                />
                <div class="option-content">
                  <span class="option-label">other…</span>
                </div>
              </label>
            </div>
            {planChoice === OTHER && (
              <div class="ccvc-other-plan">
                {/* Overflow plans (beyond the top 3) behind a native select so the
                    dialog stays compact even with many plans. Placeholder first
                    option, disabled+selected by default. */}
                {rest.length > 0 && (
                  <select
                    class="ccvc-plan-select"
                    value={planSelect}
                    onChange={(e) => {
                      setPlanSelect((e.target as HTMLSelectElement).value);
                      setPlanOther(""); // a select pick clears any typed path
                    }}
                  >
                    <option value="" disabled selected={planSelect === ""}>
                      select a plan…
                    </option>
                    {rest.map((pl) => (
                      <option value={pl.path} key={pl.path}>
                        {pl.label}
                        {pl.location === "cursor" ? " (in Cursor)" : ""}
                      </option>
                    ))}
                  </select>
                )}
                {/* …or type an explicit full path to a target .plan.md. */}
                <input
                  type="text"
                  class="question-freetext-input"
                  placeholder="…or full path to a .plan.md"
                  value={planOther}
                  onInput={(e) => setPlanOther((e.target as HTMLInputElement).value)}
                />
              </div>
            )}
          </div>
        )}

        {/* ── write: name ────────────────────────────────────────────── */}
        {phase === "write" && (
          <div class="question-block">
            <div class="question-block-header">New plan</div>
            <div class="question-text">Name for the plan (written to doc/&lt;name&gt;.plan.md):</div>
            <div class="question-freetext">
              <input
                type="text"
                class="question-freetext-input"
                placeholder="descriptive_snake_case"
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
        )}

        {/* ── update: report ─────────────────────────────────────────── */}
        {phase === "update" && (
          <div class="question-block">
            <div class="question-block-header">Report (optional)</div>
            <div class="question-freetext">
              <input
                type="text"
                class="question-freetext-input"
                placeholder="path to a .review.md / .verify.md (optional)"
                value={reportPath}
                onInput={(e) => setReportPath((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
        )}

        {/* ── toIDE: editor picker ───────────────────────────────────── */}
        {phase === "toIDE" && (
          <div class="question-block">
            <div class="question-block-header">Editor</div>
            <div class="question-text">Which editor should open the plan?</div>
            <div class="question-options">
              {(fullSettings.value?.["plans.editors"] ?? []).map((ed) => (
                <label class="question-option" key={ed.key}>
                  <input
                    type="radio"
                    name="editor-pick"
                    checked={selectedKey === ed.key}
                    onChange={() => setSelectedKey(ed.key)}
                  />
                  <div class="option-content">
                    <span class="option-label">{ed.key}</span>
                    <span class="option-description">
                      {ed.command} · {ed.directory}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ── review/build: model ────────────────────────────────────── */}
        {needsModel && (
          <div class="question-block">
            <div class="question-block-header">Who runs it</div>
            <div class="question-text">
              {phase === "review"
                ? "Best run by the model that will IMPLEMENT the plan, in a fresh context — but your call."
                : "Run inline here, or hand to a model."}
            </div>
            <div class="question-options">
              <label class="question-option">
                <input
                  type="radio"
                  name="model-pick"
                  checked={modelChoice === "session"}
                  onChange={() => setModelChoice("session")}
                />
                <div class="option-content">
                  <span class="option-label">in this session</span>
                  <span class="option-description">
                    {phase === "review"
                      ? "the author reviews its own work — misses what fresh eyes catch"
                      : "execute here (exits plan mode first)"}
                  </span>
                </div>
              </label>
              {suggested && (
                <label class="question-option">
                  <input
                    type="radio"
                    name="model-pick"
                    checked={modelChoice === suggested}
                    onChange={() => setModelChoice(suggested)}
                  />
                  <div class="option-content">
                    <span class="option-label">{suggested}</span>
                    <span class="option-description">suggested (by difficulty)</span>
                  </div>
                </label>
              )}
              <label class="question-option">
                <input
                  type="radio"
                  name="model-pick"
                  checked={modelChoice === OTHER}
                  onChange={() => setModelChoice(OTHER)}
                />
                <div class="option-content">
                  <span class="option-label">other…</span>
                </div>
              </label>
            </div>
            {modelChoice === OTHER && (
              <div class="question-options ccvc-model-list">
                {modelList.value.map((m: any) => (
                  <label class="question-option" key={m.id}>
                    <input
                      type="radio"
                      name="model-other"
                      checked={modelOther === m.id}
                      onChange={() => setModelOther(m.id)}
                    />
                    <div class="option-content">
                      <span class="option-label">{m.label ?? m.id}</span>
                      {m.description && (
                        <span class="option-description">{m.description}</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div class="ask-question-buttons">
          <button class="ask-question-cancel" type="button" onClick={close}>
            cancel
          </button>
          <button
            class="ask-question-submit"
            type="button"
            disabled={!canCommit}
            onClick={commit}
          >
            {phase}
          </button>
        </div>
      </div>
    </div>
  );
}

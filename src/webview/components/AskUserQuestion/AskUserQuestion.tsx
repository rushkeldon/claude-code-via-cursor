import "./AskUserQuestion.less";
import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { on, post } from "../../vscode";
import { messages, QuestionData } from "../../state/messages";

interface Question {
  header?: string;
  question: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

interface AskUserQuestionData {
  id: string;
  questions: Question[];
  status: "pending" | "answered" | "expired" | "cancelled";
  answers?: Record<string, string>;
  // Raw control state captured at resolve time (see QuestionData) so the
  // collapsed card can re-render the user's exact selections + typed text.
  selections?: Record<number, string[]>;
  freeTexts?: Record<number, string>;
}

export const pendingQuestions = signal<AskUserQuestionData[]>([]);

function commitToMessages(data: AskUserQuestionData) {
  const questionData: QuestionData = {
    id: data.id,
    questions: data.questions,
    status: data.status as "answered" | "expired" | "cancelled",
    answers: data.answers,
    selections: data.selections,
    freeTexts: data.freeTexts,
  };
  messages.value = [
    ...messages.value,
    {
      role: "question",
      content: "",
      questionData,
      timestamp: Date.now(),
    },
  ];
}

on("askUserQuestion" as any, (msg: any) => {
  const data = msg.data as AskUserQuestionData;
  if (data.status === "pending") {
    pendingQuestions.value = [...pendingQuestions.value, data];
  } else {
    commitToMessages(data);
  }
});

on("updateAskUserQuestionStatus" as any, (msg: any) => {
  const { id, status, answers } = msg.data;
  if (status !== "pending") {
    const q = pendingQuestions.value.find((q) => q.id === id);
    if (q) {
      pendingQuestions.value = pendingQuestions.value.filter(
        (q) => q.id !== id,
      );
      commitToMessages({ ...q, status, answers });
    }
  }
});

on("ready", () => {
  pendingQuestions.value = [];
});

on("newSession" as any, () => {
  pendingQuestions.value = [];
});

// `raw` carries the exact control state at resolve time so the collapsed card can
// reproduce the user's selections + typed text (preserved on cancel too).
type RawState = { selections: Record<number, string[]>; freeTexts: Record<number, string> };

function submitAnswers(requestId: string, answers: Record<string, string>, raw: RawState) {
  post({ type: "askUserQuestionResponse", id: requestId, answers } as any);
  const q = pendingQuestions.value.find((q) => q.id === requestId);
  if (q) {
    pendingQuestions.value = pendingQuestions.value.filter(
      (q) => q.id !== requestId,
    );
    commitToMessages({ ...q, status: "answered", answers, selections: raw.selections, freeTexts: raw.freeTexts });
  }
}

function cancelAnswers(requestId: string, raw: RawState) {
  // Decline to answer — reuses the existing deny control-response path on the
  // host side (see permissions.handleAskUserQuestionResponse). We still preserve
  // whatever the user had entered so the collapsed cancelled card shows it.
  post({ type: "askUserQuestionResponse", id: requestId, answers: {}, cancelled: true } as any);
  const q = pendingQuestions.value.find((q) => q.id === requestId);
  if (q) {
    pendingQuestions.value = pendingQuestions.value.filter(
      (q) => q.id !== requestId,
    );
    commitToMessages({ ...q, status: "cancelled", answers: {}, selections: raw.selections, freeTexts: raw.freeTexts });
  }
}

interface QuestionCardProps {
  data: AskUserQuestionData;
  isResolved?: boolean;
}

export function QuestionCard({ data, isResolved }: QuestionCardProps) {
  const resolved =
    isResolved ??
    (data.status === "answered" ||
      data.status === "expired" ||
      data.status === "cancelled");
  const cancelled = data.status === "cancelled";
  // Seed local control state from any preserved raw state (resolved cards) so the
  // read-only view reproduces exactly what the user checked/typed. Pending cards
  // start empty.
  const [selections, setSelections] = useState<Record<number, string[]>>(
    () => (data as any).selections ?? {},
  );
  const [freeTexts, setFreeTexts] = useState<Record<number, string>>(
    () => (data as any).freeTexts ?? {},
  );
  // Resolved cards start COLLAPSED (header + arrow only) — what matters next is
  // the agent's reply, not re-reading the answer; expand to revisit. Pending
  // cards are always open and cannot be collapsed.
  const [collapsed, setCollapsed] = useState(true);

  function handleOptionChange(
    qIdx: number,
    label: string,
    multiSelect: boolean,
    checked: boolean,
  ) {
    setSelections((prev) => {
      const current = prev[qIdx] || [];
      if (multiSelect) {
        return {
          ...prev,
          [qIdx]: checked
            ? [...current, label]
            : current.filter((l) => l !== label),
        };
      }
      return { ...prev, [qIdx]: [label] };
    });
  }

  function handleFreeText(qIdx: number, value: string) {
    setFreeTexts((prev) => ({ ...prev, [qIdx]: value }));
  }

  function handleSubmit() {
    const answers: Record<string, string> = {};
    data.questions.forEach((q, idx) => {
      const freeText = freeTexts[idx]?.trim();
      if (freeText) {
        answers[q.question] = freeText;
      } else {
        const selected = selections[idx];
        if (selected && selected.length > 0) {
          answers[q.question] = selected.join(", ");
        }
      }
    });
    submitAnswers(data.id, answers, { selections, freeTexts });
  }

  // Every question has an answer of some kind: a selected option or non-empty
  // free text. Used to gate the Enter-to-submit shortcut.
  function allAnswered(): boolean {
    return data.questions.every((_q, idx) => {
      if (freeTexts[idx]?.trim()) {
        return true;
      }
      const selected = selections[idx];
      return !!(selected && selected.length > 0);
    });
  }

  // Enter anywhere inside the card submits — but only once every question has an
  // answer. Pressing Enter in the free-text field while questions remain
  // unanswered does nothing (rather than submitting a partial response).
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !resolved && allAnswered()) {
      e.preventDefault();
      handleSubmit();
    }
  }

  // Resolved cards collapse to header + arrow; pending cards never collapse.
  const bodyHidden = resolved && collapsed;

  return (
    <div
      class={`ask-user-question${resolved ? " decided" : ""}${cancelled ? " cancelled" : ""}`}
      onKeyDown={handleKeyDown}
    >
      <div
        class={`ask-question-header${resolved ? " ask-question-header--toggle" : ""}`}
        onClick={resolved ? () => setCollapsed((c) => !c) : undefined}
        role={resolved ? "button" : undefined}
        title={resolved ? (collapsed ? "Expand" : "Collapse") : undefined}
      >
        {resolved && (
          <span class="ask-question-chevron">{collapsed ? "▸" : "▾"}</span>
        )}
        <span>CLAUDE Q &amp; A</span>
        {resolved && (
          <span class="ask-question-status">
            {cancelled ? "cancelled" : "answered"}
          </span>
        )}
      </div>
      {!bodyHidden && (
        <div class="ask-question-content">
          {data.questions.map((q, idx) => (
            <div class="question-block" key={idx}>
              {q.header && <div class="question-block-header">{q.header}</div>}
              <div class="question-text">{q.question}</div>
              {q.options && q.options.length > 0 && (
                <div class="question-options">
                  {q.options.map((opt, optIdx) => (
                    <label class="question-option" key={optIdx}>
                      <input
                        type={q.multiSelect ? "checkbox" : "radio"}
                        name={`q-${data.id}-${idx}`}
                        value={opt.label}
                        disabled={resolved}
                        checked={(selections[idx] || []).includes(opt.label)}
                        onChange={(e) =>
                          handleOptionChange(
                            idx,
                            opt.label,
                            !!q.multiSelect,
                            (e.target as HTMLInputElement).checked,
                          )
                        }
                      />
                      <div class="option-content">
                        <span class="option-label">{opt.label}</span>
                        {opt.description && (
                          <span class="option-description">
                            {opt.description}
                          </span>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
              {/* Free text: editable while pending; read-only (and only shown if
                  the user typed something) once resolved. */}
              {!resolved ? (
                <div class="question-freetext">
                  <input
                    type="text"
                    class="question-freetext-input"
                    placeholder="Type your answer..."
                    value={freeTexts[idx] || ""}
                    onInput={(e) =>
                      handleFreeText(idx, (e.target as HTMLInputElement).value)
                    }
                  />
                </div>
              ) : (
                freeTexts[idx]?.trim() && (
                  <div class="question-freetext">
                    <input
                      type="text"
                      class="question-freetext-input"
                      value={freeTexts[idx]}
                      disabled
                    />
                  </div>
                )
              )}
            </div>
          ))}
          {!resolved && (
            <div class="ask-question-buttons">
              <button class="ask-question-cancel" type="button" onClick={() => cancelAnswers(data.id, { selections, freeTexts })}>
                Cancel
              </button>
              <button class="ask-question-submit" type="button" onClick={handleSubmit}>
                Submit
              </button>
            </div>
          )}
          {data.status === "answered" && data.answers && (
            <div class="ask-question-decision">
              {Object.entries(data.answers).map(([q, a]) => (
                <div key={q}>
                  <strong>{q}</strong>: {a}
                </div>
              ))}
            </div>
          )}
          {cancelled && (
            <div class="ask-question-decision expired">
              Declined to answer (cancelled)
            </div>
          )}
          {data.status === "expired" && (
            <div class="ask-question-decision expired">This question expired</div>
          )}
        </div>
      )}
    </div>
  );
}

export function PendingAskUserQuestions() {
  if (pendingQuestions.value.length === 0) return null;

  return (
    <>
      {pendingQuestions.value.map((q) => (
        <QuestionCard key={q.id} data={q} />
      ))}
    </>
  );
}

export function InlineQuestionCard({
  questionData,
}: {
  questionData: QuestionData;
}) {
  const asData: AskUserQuestionData = {
    id: questionData.id,
    questions: questionData.questions,
    status: questionData.status,
    answers: questionData.answers,
  };
  return <QuestionCard data={asData} isResolved={true} />;
}

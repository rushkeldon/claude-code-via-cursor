import './AskUserQuestion.less';
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { on, post } from '../../vscode';
import { messages, QuestionData } from '../../state/messages';

interface Question {
  header?: string;
  question: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

interface AskUserQuestionData {
  id: string;
  questions: Question[];
  status: 'pending' | 'answered' | 'expired' | 'cancelled';
  answers?: Record<string, string>;
}

export const pendingQuestions = signal<AskUserQuestionData[]>([]);

function commitToMessages(data: AskUserQuestionData) {
  const questionData: QuestionData = {
    id: data.id,
    questions: data.questions,
    status: data.status as 'answered' | 'expired' | 'cancelled',
    answers: data.answers,
  };
  messages.value = [...messages.value, {
    role: 'question',
    content: '',
    questionData,
    timestamp: Date.now(),
  }];
}

on('askUserQuestion' as any, (msg: any) => {
  const data = msg.data as AskUserQuestionData;
  if (data.status === 'pending') {
    pendingQuestions.value = [...pendingQuestions.value, data];
  } else {
    commitToMessages(data);
  }
});

on('updateAskUserQuestionStatus' as any, (msg: any) => {
  const { id, status, answers } = msg.data;
  if (status !== 'pending') {
    const q = pendingQuestions.value.find(q => q.id === id);
    if (q) {
      pendingQuestions.value = pendingQuestions.value.filter(q => q.id !== id);
      commitToMessages({ ...q, status, answers });
    }
  }
});

on('ready', () => {
  pendingQuestions.value = [];
});

on('newSession' as any, () => {
  pendingQuestions.value = [];
});

function submitAnswers(requestId: string, answers: Record<string, string>) {
  post({ type: 'askUserQuestionResponse', id: requestId, answers } as any);
  const q = pendingQuestions.value.find(q => q.id === requestId);
  if (q) {
    pendingQuestions.value = pendingQuestions.value.filter(q => q.id !== requestId);
    commitToMessages({ ...q, status: 'answered', answers });
  }
}

interface QuestionCardProps {
  data: AskUserQuestionData;
  isResolved?: boolean;
}

export function QuestionCard({ data, isResolved }: QuestionCardProps) {
  const resolved = isResolved ?? (data.status === 'answered' || data.status === 'expired' || data.status === 'cancelled');
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [freeTexts, setFreeTexts] = useState<Record<number, string>>({});

  function handleOptionChange(qIdx: number, label: string, multiSelect: boolean, checked: boolean) {
    setSelections(prev => {
      const current = prev[qIdx] || [];
      if (multiSelect) {
        return { ...prev, [qIdx]: checked ? [...current, label] : current.filter(l => l !== label) };
      }
      return { ...prev, [qIdx]: [label] };
    });
  }

  function handleFreeText(qIdx: number, value: string) {
    setFreeTexts(prev => ({ ...prev, [qIdx]: value }));
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
          answers[q.question] = selected.join(', ');
        }
      }
    });
    submitAnswers(data.id, answers);
  }

  return (
    <div class={`ask-user-question${resolved ? ' decided' : ''}`}>
      <div class="ask-question-header">
        <span class="ask-question-icon">❓</span>
        <span>Claude has a question</span>
      </div>
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
                      type={q.multiSelect ? 'checkbox' : 'radio'}
                      name={`q-${data.id}-${idx}`}
                      value={opt.label}
                      disabled={resolved}
                      onChange={(e) => handleOptionChange(idx, opt.label, !!q.multiSelect, (e.target as HTMLInputElement).checked)}
                    />
                    <div class="option-content">
                      <span class="option-label">{opt.label}</span>
                      {opt.description && <span class="option-description">{opt.description}</span>}
                    </div>
                  </label>
                ))}
              </div>
            )}
            {!resolved && (
              <div class="question-freetext">
                <input
                  type="text"
                  class="question-freetext-input"
                  placeholder="Type your answer..."
                  onInput={(e) => handleFreeText(idx, (e.target as HTMLInputElement).value)}
                />
              </div>
            )}
          </div>
        ))}
        {!resolved && (
          <div class="ask-question-buttons">
            <button class="btn primary" type="button" onClick={handleSubmit}>Submit</button>
          </div>
        )}
        {data.status === 'answered' && data.answers && (
          <div class="ask-question-decision">
            {Object.entries(data.answers).map(([q, a]) => (
              <div key={q}><strong>{q}</strong>: {a}</div>
            ))}
          </div>
        )}
        {(data.status === 'expired' || data.status === 'cancelled') && (
          <div class="ask-question-decision expired">This question expired</div>
        )}
      </div>
    </div>
  );
}

export function PendingAskUserQuestions() {
  if (pendingQuestions.value.length === 0) return null;

  return (
    <>
      {pendingQuestions.value.map(q => <QuestionCard key={q.id} data={q} />)}
    </>
  );
}

export function InlineQuestionCard({ questionData }: { questionData: QuestionData }) {
  const asData: AskUserQuestionData = {
    id: questionData.id,
    questions: questionData.questions,
    status: questionData.status,
    answers: questionData.answers,
  };
  return <QuestionCard data={asData} isResolved={true} />;
}

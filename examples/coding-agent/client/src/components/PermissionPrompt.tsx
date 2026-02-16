import { useState, useEffect } from "react";
import type { Slot } from "../hooks/useAgent";

/* -------------------------------------------------------------------------- */
/*  Modal overlay                                                              */
/*                                                                             */
/*  Renders slots as a stacked modal system. When multiple permissions arrive   */
/*  at once, only the top one is shown; resolving it reveals the next.         */
/*  The overlay dims the background and captures focus.                        */
/* -------------------------------------------------------------------------- */

function ModalOverlay({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  // Trap escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onDismiss) {
        onDismiss();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onDismiss]);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        // Only dismiss when clicking the backdrop, not the modal content
        if (e.target === e.currentTarget && onDismiss) {
          onDismiss();
        }
      }}
    >
      <div className="modal-content">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Permission prompt                                                          */
/* -------------------------------------------------------------------------- */

export function PermissionPrompt({
  slot,
  onResolve,
}: {
  slot: Slot;
  onResolve: (value: unknown) => void;
}) {
  const input = slot.input as { toolName?: string; toolInput?: unknown };

  // Keyboard shortcut: y = allow, n = deny
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        onResolve(true);
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        onResolve(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onResolve]);

  return (
    <div className="permission-prompt">
      <div className="permission-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--yellow)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <div className="permission-body">
        <div className="permission-header">Permission required</div>
        <div className="permission-tool">
          <span className="permission-tool-name">{input.toolName ?? "unknown"}</span>
          {input.toolInput != null && (
            <pre className="permission-tool-input">
              {JSON.stringify(input.toolInput, null, 2).slice(0, 200)}
            </pre>
          )}
        </div>
        <div className="permission-actions">
          <button
            className="btn btn-allow"
            onClick={() => onResolve(true)}
          >
            <span>Allow</span>
            <kbd>Y</kbd>
          </button>
          <button
            className="btn btn-deny"
            onClick={() => onResolve(false)}
          >
            <span>Deny</span>
            <kbd>N</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Plan approval                                                              */
/* -------------------------------------------------------------------------- */

export function PlanApproval({
  slot,
  onResolve,
}: {
  slot: Slot;
  onResolve: (value: unknown) => void;
}) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const input = slot.input as {
    title?: string;
    steps?: string[];
    summary?: string;
  };

  return (
    <div className="plan-approval">
      <div className="plan-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </div>
      <div className="plan-body">
        <div className="plan-header">Plan: {input.title ?? "Untitled"}</div>
        {input.summary && (
          <div className="plan-summary">{input.summary}</div>
        )}
        <ol className="plan-steps">
          {(input.steps ?? []).map((step, i) => (
            <li key={i} className="plan-step">
              {step}
            </li>
          ))}
        </ol>

        {showFeedback && (
          <div className="plan-feedback">
            <textarea
              className="plan-feedback-input"
              placeholder="Describe what you'd like to change..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              autoFocus
            />
            <button
              className="btn btn-allow"
              onClick={() => onResolve({ action: "modify", feedback })}
              disabled={!feedback.trim()}
            >
              Send feedback
            </button>
          </div>
        )}

        <div className="plan-actions">
          <button
            className="btn btn-allow"
            onClick={() => onResolve({ action: "approve" })}
          >
            Approve
          </button>
          <button
            className="btn btn-modify"
            onClick={() => setShowFeedback(!showFeedback)}
          >
            {showFeedback ? "Cancel" : "Modify"}
          </button>
          <button
            className="btn btn-deny"
            onClick={() => onResolve({ action: "reject" })}
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Question prompt                                                            */
/* -------------------------------------------------------------------------- */

interface QuestionItem {
  question: string;
  options?: string[];
}

export function QuestionPrompt({
  slot,
  onResolve,
}: {
  slot: Slot;
  onResolve: (value: unknown) => void;
}) {
  const input = slot.input as { questions?: QuestionItem[] };
  const questions = input.questions ?? [];
  const [answers, setAnswers] = useState<string[]>(() =>
    new Array(questions.length).fill(""),
  );

  const setAnswer = (idx: number, value: string) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  const allAnswered = answers.every((a) => a.trim().length > 0);

  const submit = () => {
    if (allAnswered) {
      onResolve(questions.length === 1 ? answers[0] : answers);
    }
  };

  return (
    <div className="question-prompt">
      <div className="question-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <div className="question-body">
        {questions.map((q, i) => (
          <div key={i} className="question-block">
            <div className="question-header">{q.question}</div>
            {q.options && q.options.length > 0 && (
              <div className="question-options">
                {q.options.map((opt, j) => (
                  <button
                    key={j}
                    className={`btn question-option${answers[i] === opt ? " question-option-selected" : ""}`}
                    onClick={() => setAnswer(i, opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
            <input
              className="question-input"
              type="text"
              placeholder="Type your answer..."
              value={answers[i]}
              onChange={(e) => setAnswer(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoFocus={i === 0}
            />
          </div>
        ))}
        <div className="question-submit">
          <button
            className="btn btn-allow"
            onClick={submit}
            disabled={!allAnswered}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Slot renderer - wraps each slot type in a modal overlay                    */
/* -------------------------------------------------------------------------- */

export function SlotRenderer({
  slot,
  onResolve,
}: {
  slot: Slot;
  onResolve: (value: unknown) => void;
}) {
  let content: React.ReactNode;

  if (slot.renderer === "permission_request") {
    content = <PermissionPrompt slot={slot} onResolve={onResolve} />;
  } else if (slot.renderer === "plan_approval") {
    content = <PlanApproval slot={slot} onResolve={onResolve} />;
  } else if (slot.renderer === "ask_question") {
    content = <QuestionPrompt slot={slot} onResolve={onResolve} />;
  } else {
    content = (
      <div className="slot-generic">
        <span className="dim">
          [{slot.renderer}] {JSON.stringify(slot.input).slice(0, 120)}
        </span>
      </div>
    );
  }

  return <ModalOverlay>{content}</ModalOverlay>;
}

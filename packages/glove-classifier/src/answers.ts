import { ClassifierError } from "./errors";
import { questionOptions } from "./questions";
import type {
  Answer,
  AnswerFor,
  ChoiceAnswer,
  NoulAnswer,
  Question,
  ScoreAnswer,
  ScoreQuestion,
} from "./types";

/**
 * Confidence of a distribution: 1 when all mass sits on one option, 0 when
 * it is spread evenly. `(n · peak − 1) / (n − 1)`, clamped to [0, 1].
 *
 * This is the approximation TypeSafe documents for its own `confidence`
 * field. Adapters that get confidence from the provider pass it through;
 * the ones that only have a distribution (the LLM adapter) use this.
 */
export function distributionConfidence(probabilities: readonly number[]): number {
  const n = probabilities.length;
  if (n <= 1) return 1;
  const peak = Math.max(...probabilities);
  return clamp01((n * peak - 1) / (n - 1));
}

/**
 * How certain an answer is, 0–1, for any answer type. Choice and score use
 * the answer's own `confidence`; a noul has none, so its certainty is its
 * distance from a coin flip: `|2p − 1|` (0.5 → 0, 0 or 1 → 1).
 */
export function answerConfidence(answer: Answer): number {
  return answer.type === "noul" ? Math.abs(2 * answer.noul - 1) : answer.confidence;
}

export type Gate = "act" | "review" | "escalate";

export interface GateThresholds {
  /** At or above this, act automatically. Default 0.8. */
  act?: number;
  /** At or above this (but below `act`), proceed with review. Default 0.5. */
  review?: number;
}

/**
 * Confidence-gated routing: the answer says *what*, the gate says *whether
 * to act on it*. High confidence → `"act"`, medium → `"review"`, low →
 * `"escalate"` (a human, a clarifying question, or a reasoning model).
 * Thresholds scale with the stakes of the action, so pass them per call site.
 */
export function gate(answer: Answer | number, thresholds: GateThresholds = {}): Gate {
  const act = thresholds.act ?? 0.8;
  const review = thresholds.review ?? 0.5;
  const c = typeof answer === "number" ? answer : answerConfidence(answer);
  if (c >= act) return "act";
  if (c >= review) return "review";
  return "escalate";
}

/**
 * Build the answer for `question` from a probability distribution over its
 * options (see {@link questionOptions}: `"true"`/`"false"` for a noul, the
 * labels for a choice, `"0"…"n-1"` for a score). Missing options count as 0;
 * the rest is normalized. Throws `bad_response` when nothing usable is left.
 */
export function answerFromDistribution<Q extends Question>(
  question: Q,
  distribution: Readonly<Record<string, number>>,
): AnswerFor<Q> {
  if (question.type === "noul" && distribution.false === undefined) {
    // A bare P(yes) — don't normalize it against a missing "false" into 1.
    const p = distribution.true;
    if (typeof p !== "number" || !Number.isFinite(p)) {
      throw new ClassifierError("bad_response", "noul answer has no probability for \"true\"");
    }
    return { type: "noul", noul: clamp01(p) } satisfies NoulAnswer as AnswerFor<Q>;
  }
  const options = questionOptions(question);
  const probs = normalize(options.map((o) => distribution[o]));
  if (!probs) {
    throw new ClassifierError("bad_response", "answer distribution has no positive mass");
  }
  switch (question.type) {
    case "noul":
      return { type: "noul", noul: probs[0]! } satisfies NoulAnswer as AnswerFor<Q>;
    case "choice":
      return choiceAnswer(options, probs) as AnswerFor<Q>;
    case "score":
      return scoreAnswer(question, probs) as AnswerFor<Q>;
  }
  throw new ClassifierError("invalid_request", "unknown question type");
}

function choiceAnswer(labels: string[], probs: number[]): ChoiceAnswer {
  let best = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i]! > probs[best]!) best = i;
  return {
    type: "choice",
    choice: labels[best]!,
    confidence: distributionConfidence(probs),
    probabilities: Object.fromEntries(labels.map((l, i) => [l, probs[i]!])),
  };
}

function scoreAnswer(question: ScoreQuestion, probs: number[]): ScoreAnswer {
  return {
    type: "score",
    score: probs.reduce((sum, p, level) => sum + p * level, 0),
    confidence: distributionConfidence(probs),
    legend: Object.fromEntries(question.criteria.map((d, i) => [String(i), d])),
    probabilities: Object.fromEntries(probs.map((p, i) => [String(i), p])),
  } as ScoreAnswer;
}

/** Clamp non-finite and negative entries to 0 and rescale to sum 1; null when the sum is 0. */
export function normalize(values: ReadonlyArray<number | undefined>): number[] | null {
  const clean = values.map((v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  return clean.map((v) => v / sum);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

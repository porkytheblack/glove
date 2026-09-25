import { ClassifierError } from "./errors";
import type {
  ChoiceCriteria,
  ChoiceQuestion,
  ClassifyRequest,
  Description,
  NoulQuestion,
  Question,
  Questions,
  ScoreCriteria,
  ScoreQuestion,
} from "./types";

/** TypeSafe's limits; the LLM adapter enforces the same so questions stay portable. */
export const MAX_CHOICE_OPTIONS = 255;
export const MAX_SCORE_LEVELS = 10;

/** A yes/no question: "is this statement true of the state?" */
export function noul(
  instructions: Description,
  criteria?: { true?: Description; false?: Description },
): NoulQuestion {
  return criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions };
}

/**
 * Pick one label. Pass labels mapped to descriptions, or a bare list of
 * labels when the names speak for themselves. Answer types carry the labels:
 * `answers.department.choice` is `"billing" | "technical" | "sales"`.
 */
export function choice<const T extends ChoiceCriteria>(
  instructions: Description,
  criteria: T,
): ChoiceQuestion<T>;
export function choice<const L extends readonly string[]>(
  instructions: Description,
  labels: L,
): ChoiceQuestion<{ [K in L[number]]: null }>;
export function choice(
  instructions: Description,
  criteria: ChoiceCriteria | readonly string[],
): ChoiceQuestion {
  const map: ChoiceCriteria = Array.isArray(criteria)
    ? Object.fromEntries((criteria as readonly string[]).map((label) => [label, null]))
    : (criteria as ChoiceCriteria);
  return { type: "choice", instructions, criteria: map };
}

/** Rate the state on an ordered rubric, lowest level first. */
export function score<const T extends ScoreCriteria>(
  instructions: Description,
  levels: T,
): ScoreQuestion<T> {
  return { type: "score", instructions, criteria: levels };
}

/** The labels a question's answer distribution is over, in order. */
export function questionOptions(question: Question): string[] {
  switch (question.type) {
    case "noul":
      return ["true", "false"];
    case "choice":
      return Object.keys(question.criteria);
    case "score":
      return question.criteria.map((_, i) => String(i));
  }
}

/**
 * Validate a request against the limits every adapter shares. Throws
 * `ClassifierError("invalid_request")` naming the offending question, so a
 * malformed question fails locally instead of costing a round trip.
 */
export function assertValidRequest(request: ClassifyRequest<Questions>): void {
  if (request == null || typeof request !== "object") {
    throw new ClassifierError("invalid_request", "classify() needs a { state, questions } request");
  }
  if (request.state === undefined) {
    throw new ClassifierError("invalid_request", "`state` is required");
  }
  const questions = request.questions;
  if (questions == null || typeof questions !== "object" || Array.isArray(questions)) {
    throw new ClassifierError("invalid_request", "`questions` must be an object keyed by question id");
  }
  const ids = Object.keys(questions);
  if (ids.length === 0) {
    throw new ClassifierError("invalid_request", "`questions` must contain at least one question");
  }
  for (const id of ids) assertValidQuestion(id, questions[id]!);
}

function assertValidQuestion(id: string, question: Question): void {
  const fail = (why: string) => {
    throw new ClassifierError("invalid_request", `question "${id}": ${why}`);
  };
  if (question == null || typeof question !== "object") fail("must be an object");
  switch (question.type) {
    case "noul":
      if (question.criteria != null && typeof question.criteria !== "object") {
        fail("noul criteria must be { true?, false? }");
      }
      return;
    case "choice": {
      const criteria = question.criteria;
      if (criteria == null || typeof criteria !== "object" || Array.isArray(criteria)) {
        fail("choice criteria must map each label to a description (or null)");
      }
      const n = Object.keys(criteria).length;
      if (n < 2) fail("choice needs at least two labels");
      if (n > MAX_CHOICE_OPTIONS) fail(`choice allows at most ${MAX_CHOICE_OPTIONS} labels (got ${n})`);
      return;
    }
    case "score": {
      const levels = question.criteria;
      if (!Array.isArray(levels)) fail("score criteria must be an ordered array of levels");
      if (levels.length < 2) fail("score needs at least two levels");
      if (levels.length > MAX_SCORE_LEVELS) {
        fail(`score allows at most ${MAX_SCORE_LEVELS} levels (got ${levels.length})`);
      }
      return;
    }
    default:
      fail(`unknown question type ${JSON.stringify((question as { type?: unknown }).type)}`);
  }
}

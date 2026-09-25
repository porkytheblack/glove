/**
 * The classifier vocabulary.
 *
 * A classifier model does not write text. It takes a *state* (the thing being
 * judged) and a map of typed *questions*, and returns one typed answer per
 * question with a probability distribution behind it. The three question
 * kinds are the ones TypeSafe's System One models (Jev) expose, and they are
 * general enough to describe any classifier:
 *
 * | kind     | asks                        | answer                                  |
 * | -------- | --------------------------- | --------------------------------------- |
 * | `noul`   | is this statement true?     | `noul` — probability of yes, 0–1        |
 * | `choice` | which of these labels?      | `choice`, `probabilities`, `confidence` |
 * | `score`  | where on this rubric?       | `score`, `probabilities`, `confidence`  |
 *
 * Every adapter in this package — TypeSafe's hosted Jev, an LLM emulating one,
 * a cascade of both — speaks exactly these shapes, so code that branches on
 * answers never cares which model produced them. Field names match the
 * TypeSafe wire format (and its SDK types) so a request built here can be
 * sent to `POST /v1/systemone` as-is.
 */

/** A JSON-compatible value. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Text, a JSON object, or a JSON array. Used for state, instructions and
 * criteria. An object lets a question hold its prompt in one field and the
 * data it refers to in others.
 */
export type Entry = string | { [key: string]: JsonValue } | JsonValue[];

/** An {@link Entry}, or `null` to leave a label undescribed. */
export type Description = Entry | null;

// ─── Questions ───────────────────────────────────────────────────────────────

/** A yes/no question. The answer is the probability that the answer is yes. */
export interface NoulQuestion {
  type: "noul";
  instructions?: Description;
  /** Optional descriptions of what a yes and a no mean. */
  criteria?: { true?: Description; false?: Description } | null;
}

/** Labels mapped to descriptions (`null` for a label that needs none). */
export type ChoiceCriteria = { [label: string]: Description };

/** Pick one label from a set you define. */
export interface ChoiceQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
  type: "choice";
  instructions?: Description;
  criteria: T;
}

/** Ordered rubric levels, lowest first. At least two. */
export type ScoreCriteria = readonly [Description, Description, ...Description[]];

/** Rate the state on an ordered rubric. */
export interface ScoreQuestion<T extends ScoreCriteria = ScoreCriteria> {
  type: "score";
  instructions?: Description;
  criteria: T;
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** Questions keyed by the id their answer comes back under. */
export interface Questions {
  [id: string]: Question;
}

// ─── Answers ─────────────────────────────────────────────────────────────────

export interface NoulAnswer {
  readonly type: "noul";
  /** Probability the answer is yes, 0–1. */
  readonly noul: number;
}

export interface ChoiceAnswer<T extends ChoiceCriteria = ChoiceCriteria> {
  readonly type: "choice";
  /** The highest-probability label. */
  readonly choice: keyof T & string;
  /** How certain the model is, 0–1, derived from `probabilities`. */
  readonly confidence: number;
  /** Every label mapped to its probability; sums to 1. */
  readonly probabilities: { readonly [label in keyof T]: number };
}

/** Level keys of a rubric: its indices for a fixed tuple, else `number`. */
export type ScoreLevel<T extends ScoreCriteria> = number extends T["length"]
  ? `${number}`
  : Extract<keyof T, `${number}`>;

export interface ScoreAnswer<T extends ScoreCriteria = ScoreCriteria> {
  readonly type: "score";
  /** Probability-weighted level; can land between levels. */
  readonly score: number;
  /** How certain the model is, 0–1, derived from `probabilities`. */
  readonly confidence: number;
  /** Each level index mapped back to its description. */
  readonly legend: { readonly [level in ScoreLevel<T>]: Description };
  /** Each level index mapped to its probability; sums to 1. */
  readonly probabilities: { readonly [level in ScoreLevel<T>]: number };
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** The answer type for a question, preserving its labels. */
export type AnswerFor<Q extends Question> = Q extends NoulQuestion
  ? NoulAnswer
  : Q extends ScoreQuestion<infer S>
    ? ScoreAnswer<S>
    : Q extends ChoiceQuestion<infer C>
      ? ChoiceAnswer<C>
      : never;

/** Answers keyed by question id, typed from the questions. */
export type Answers<Q extends Questions> = { readonly [K in keyof Q]: AnswerFor<Q[K]> };

// ─── Requests and results ────────────────────────────────────────────────────

export interface ClassifierUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

export interface ClassifyRequest<Q extends Questions = Questions> {
  /** The content every question is judged against. */
  state: Entry;
  /** At least one question, keyed by the id its answer returns under. */
  questions: Q;
  /** Per-call model override. Adapters that serve one model ignore it. */
  model?: string;
}

export interface ClassifyOptions {
  signal?: AbortSignal;
}

export interface ClassifyResult<Q extends Questions = Questions> {
  /** The model that actually answered (a versioned id when the provider reports one). */
  readonly model: string;
  readonly answers: Answers<Q>;
  readonly usage: ClassifierUsage;
}

/**
 * A structured-decision model: state and typed questions in, typed answers
 * with probabilities out.
 *
 * Implement this to bring any classifier to Glove. Adapters must return one
 * answer per question id, with the same `type` as the question; the helpers
 * in `./answers` build well-formed answers from a probability distribution.
 */
export interface ClassifierAdapter {
  readonly name: string;
  classify<Q extends Questions>(
    request: ClassifyRequest<Q>,
    options?: ClassifyOptions,
  ): Promise<ClassifyResult<Q>>;
}

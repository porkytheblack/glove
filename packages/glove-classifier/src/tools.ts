/**
 * Classifier tools for a Glove agent.
 *
 * Both factories return `GloveFoldArgs`, so they register with `glove.fold()`:
 *
 * - {@link classifierTool} — an open tool. The agent writes its own state and
 *   questions and gets typed answers back: a fast, calibrated "gut check" it
 *   can fan out over many items instead of reasoning through each in context.
 * - {@link defineClassifierTool} — a fixed tool. You write the questions; the
 *   agent only supplies the input. Use it for decisions you want made the
 *   same way every time (triage, moderation, routing).
 */
import { AbortError } from "glove-core/core";
import type { GloveFoldArgs } from "glove-core/glove";
import { z } from "zod";
import { ClassifierError } from "./errors";
import { normalizeQuestions } from "./normalize";
import type {
  Answer,
  Answers,
  ClassifierAdapter,
  ClassifyResult,
  Entry,
  Questions,
} from "./types";

type AnyZodObject = z.ZodObject<any, any>;

export const classifierEntrySchema = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);
const entrySchema = classifierEntrySchema;
const descriptionSchema = entrySchema.nullable();

/**
 * Deliberately lenient: models write questions as bare strings, omit
 * `instructions`, and use `yes_no` or `options`. Tool handlers pass what they
 * receive through {@link normalizeQuestions}, which maps those shapes to the
 * canonical ones and validates the result with a readable error.
 */
export const classifierQuestionSchema = z.union([
  z.string().describe('A yes/no question. Shorthand for { type: "noul", instructions: <this text> }.'),
  z.looseObject({
    type: z
      .string()
      .describe('"noul" (yes/no → probability of yes), "choice" (pick one label), or "score" (rate on an ordered rubric).'),
    instructions: descriptionSchema.optional().describe("The question itself."),
    criteria: z
      .unknown()
      .optional()
      .describe(
        "choice: the labels, as a list or { label: description }. score: ordered levels, lowest first (2–10). noul: optional { true, false } descriptions.",
      ),
  }),
]);

export const classifyToolInputSchema = z.object({
  state: entrySchema.describe(
    "The content every question is judged against: text, or a JSON object/array with named fields.",
  ),
  questions: z
    .record(z.string(), classifierQuestionSchema)
    .describe("Questions keyed by an id you choose; answers come back under the same ids."),
});

export type ClassifyToolInput = z.infer<typeof classifyToolInputSchema>;

export const CLASSIFIER_TOOL_DESCRIPTION = `Make fast, calibrated judgements about a piece of content. Pass a \`state\` and a map of typed questions; every question is judged independently and in parallel, in one call.

Question types:
- noul — a yes/no question. Returns \`noul\`: the probability the answer is yes (0–1).
- choice — pick one label from \`criteria\` (label → description). Returns \`choice\`, per-label \`probabilities\`, and \`confidence\`.
- score — rate on ordered rubric levels in \`criteria\` (lowest first). Returns \`score\` (can land between levels), per-level \`probabilities\`, and \`confidence\`.

Example: { "state": "...", "questions": { "refund": "Does the sender ask for a refund?", "team": { "type": "choice", "instructions": "Which team?", "criteria": ["billing", "technical", "sales"] } } }

Ask atomic questions — each one a judgement an expert could make in seconds. Break a broad judgement into several questions and combine the answers yourself. Asking more questions in the same call is nearly free. Low confidence means the state is ambiguous or lacks what the question needs: don't act on it blindly. This tool classifies, routes, scores and verifies; it does not write text.`;

export interface ClassifierToolOptions {
  classifier: ClassifierAdapter;
  /** Default `glove_classify`. */
  name?: string;
  description?: string;
  requiresPermission?: boolean;
}

/** An open classifier tool: the agent composes the state and questions. */
export function classifierTool(options: ClassifierToolOptions): GloveFoldArgs<ClassifyToolInput> {
  return {
    name: options.name ?? "glove_classify",
    description: options.description ?? CLASSIFIER_TOOL_DESCRIPTION,
    inputSchema: classifyToolInputSchema,
    ...(options.requiresPermission !== undefined && { requiresPermission: options.requiresPermission }),
    async do(input, _display, _glove, signal) {
      let questions: Questions;
      try {
        questions = normalizeQuestions(input.questions);
      } catch (err) {
        return { status: "error" as const, data: null, message: (err as Error).message };
      }
      return runClassify(options.classifier, input.state as Entry, questions, signal);
    },
  };
}

export interface DefineClassifierToolOptions<Q extends Questions, S extends AnyZodObject> {
  name: string;
  description: string;
  classifier: ClassifierAdapter;
  /** The fixed questions every call asks. */
  questions: Q;
  /** Tool input schema. Default `{ text: string }`. */
  input?: S;
  /** Build the state from the tool input. Default: `input.text`, else the whole input. */
  state?: (input: z.infer<S>) => Entry;
  /**
   * Shape what the agent sees. Default: the compact answers. Return a string
   * or any JSON value — e.g. only the routing decision, never the probabilities.
   */
  format?: (answers: Answers<Q>, result: ClassifyResult<Q>) => unknown;
  requiresPermission?: boolean;
}

const defaultInput = z.object({ text: z.string().describe("The content to judge.") });

/** A fixed-question classifier tool: you write the questions, the agent supplies the input. */
export function defineClassifierTool<
  Q extends Questions,
  S extends AnyZodObject = typeof defaultInput,
>(options: DefineClassifierToolOptions<Q, S>): GloveFoldArgs<z.infer<S>> {
  const schema = (options.input ?? defaultInput) as S;
  const toState =
    options.state ??
    ((input: z.infer<S>) =>
      typeof (input as { text?: unknown }).text === "string"
        ? (input as { text: string }).text
        : (input as Entry));
  return {
    name: options.name,
    description: options.description,
    inputSchema: schema as unknown as z.ZodType<z.infer<S>>,
    ...(options.requiresPermission !== undefined && { requiresPermission: options.requiresPermission }),
    async do(input, _display, _glove, signal) {
      return runClassify(options.classifier, toState(input), options.questions, signal, options.format);
    },
  };
}

export async function runClassify<Q extends Questions>(
  classifier: ClassifierAdapter,
  state: Entry,
  questions: Q,
  signal: AbortSignal | undefined,
  format?: (answers: Answers<Q>, result: ClassifyResult<Q>) => unknown,
) {
  try {
    const result = await classifier.classify({ state, questions }, { signal });
    const data = format
      ? format(result.answers, result)
      : { model: result.model, answers: compactAnswers(result.answers) };
    return { status: "success" as const, data, renderData: result };
  } catch (err) {
    if (err instanceof AbortError || signal?.aborted) throw err;
    const message = err instanceof ClassifierError
      ? `${err.code}: ${err.message}`
      : err instanceof Error ? err.message : String(err);
    return { status: "error" as const, data: null, message };
  }
}

/**
 * Answers trimmed for a model's context: numbers rounded to 3 places and the
 * score legend dropped (the agent wrote the rubric; it doesn't need it back).
 */
export function compactAnswers(answers: Readonly<Record<string, Answer>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, a] of Object.entries(answers)) {
    switch (a.type) {
      case "noul":
        out[id] = { noul: round(a.noul) };
        break;
      case "choice":
        out[id] = { choice: a.choice, confidence: round(a.confidence), probabilities: roundAll(a.probabilities) };
        break;
      case "score":
        out[id] = { score: round(a.score), confidence: round(a.confidence), probabilities: roundAll(a.probabilities) };
        break;
    }
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function roundAll(p: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, round(v)]));
}

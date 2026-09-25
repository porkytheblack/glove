/**
 * Classify many states against the same questions, and filter the results.
 *
 * This is the shape almost every integration needs: an inbox of emails, a
 * page of search results, a queue of inbound transmissions. Each item is
 * judged independently; only ids and answers come back, so the caller (a
 * REPL program, a tool, a router) can decide what deserves a closer look
 * without the items ever entering a model's context.
 */
import { AbortError } from "glove-core/core";
import { ClassifierError } from "./errors";
import type {
  Answer,
  Answers,
  ClassifierAdapter,
  ClassifierUsage,
  Entry,
  Questions,
} from "./types";

export interface ClassifyItem {
  /** Stable id the result comes back under. */
  id: string;
  state: Entry;
  /** Optional human-readable label (a subject line, a URL) echoed in results. */
  label?: string;
}

export interface ClassifyManyOptions {
  /** Parallel requests. Default 8. */
  concurrency?: number;
  signal?: AbortSignal;
  model?: string;
}

export interface ClassifiedItem<Q extends Questions = Questions> {
  id: string;
  label?: string;
  /** Present when the item was classified. */
  answers?: Answers<Q>;
  /** Present when this item failed; other items still complete. */
  error?: string;
}

export interface ClassifyManyResult<Q extends Questions = Questions> {
  items: Array<ClassifiedItem<Q>>;
  usage: ClassifierUsage;
  /** Distinct models that answered. */
  models: string[];
}

/**
 * Classify every item. Per-item failures are captured on the item rather
 * than failing the batch; an abort stops the batch and throws `AbortError`.
 */
export async function classifyMany<Q extends Questions>(
  classifier: ClassifierAdapter,
  items: ReadonlyArray<ClassifyItem>,
  questions: Q,
  options: ClassifyManyOptions = {},
): Promise<ClassifyManyResult<Q>> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 8));
  const out: Array<ClassifiedItem<Q>> = new Array(items.length);
  const models = new Set<string>();
  let input = 0;
  let output = 0;
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index]!;
      if (options.signal?.aborted) throw new AbortError();
      const base: ClassifiedItem<Q> = item.label === undefined ? { id: item.id } : { id: item.id, label: item.label };
      try {
        const res = await classifier.classify(
          { state: item.state, questions, ...(options.model && { model: options.model }) },
          { signal: options.signal },
        );
        models.add(res.model);
        input += res.usage.input_tokens;
        output += res.usage.output_tokens;
        out[index] = { ...base, answers: res.answers };
      } catch (err) {
        if (err instanceof AbortError || options.signal?.aborted) throw err;
        // A malformed question fails every item identically — surface it once.
        if (err instanceof ClassifierError && err.code === "invalid_request" && err.status === undefined) throw err;
        out[index] = { ...base, error: err instanceof Error ? err.message : String(err) };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { items: out, usage: { input_tokens: input, output_tokens: output }, models: [...models] };
}

// ─── Filtering ───────────────────────────────────────────────────────────────

/**
 * A condition on one answer.
 *
 * - noul: matches when `noul >= min` (default 0.5) and `<= max` (default 1).
 * - choice: matches when the chosen label is `choice`; with `min`/`max`, when
 *   the probability of `choice` is in range instead (e.g. "billing ≥ 0.3").
 * - score: matches when `score` is within `min`/`max`.
 */
export interface Where {
  question: string;
  choice?: string;
  min?: number;
  max?: number;
}

/** True when `answer` satisfies `where` (see {@link Where}). */
export function answerMatches(answer: Answer | undefined, where: Where): boolean {
  if (!answer) return false;
  const max = where.max ?? Number.POSITIVE_INFINITY;
  switch (answer.type) {
    case "noul": {
      const min = where.min ?? 0.5;
      return answer.noul >= min && answer.noul <= max;
    }
    case "choice": {
      if (where.choice === undefined) return where.min === undefined || answer.confidence >= where.min;
      if (where.min === undefined && where.max === undefined) return answer.choice === where.choice;
      const p = (answer.probabilities as Record<string, number>)[where.choice] ?? 0;
      return p >= (where.min ?? 0) && p <= max;
    }
    case "score":
      return answer.score >= (where.min ?? Number.NEGATIVE_INFINITY) && answer.score <= max;
  }
}

/** True when every condition holds (an empty list matches everything). */
export function answersMatch(
  answers: Readonly<Record<string, Answer>> | undefined,
  where: Where | ReadonlyArray<Where> | undefined,
): boolean {
  if (!answers) return false;
  const conditions = where === undefined ? [] : Array.isArray(where) ? where : [where as Where];
  return conditions.every((w) => answerMatches(answers[w.question], w));
}

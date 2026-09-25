/**
 * Classifier judgements over a live browser page.
 *
 * `withClassifier(adapter, { classifier })` decorates a glove-execution
 * `BrowserAdapter` with a `judge` operation: it observes the page itself,
 * hands the observation to the classifier, and returns only the answers.
 * "Is this a login wall?", "did the checkout succeed?", "which of these
 * results is the pricing page?" — answered without the DOM ever entering
 * the agent's context.
 *
 * ```ts
 * mountBrowser(glove, { adapter: withClassifier(stationBrowser(...), { classifier: jev() }) });
 * // in a workflow script:  const { answers } = await browser.judge({ sessionId, questions })
 * ```
 *
 * The types here are structural copies of glove-execution's, so this module
 * adds no dependency.
 */
import { assertValidRequest } from "./questions";
import { compactAnswers } from "./tools";
import type { Answer, ClassifierAdapter, Entry, Questions } from "./types";

interface ExecutionResultLike {
  status: "success" | "error";
  data?: unknown;
  error?: { code: string; message: string; outcome?: "unknown" };
  images?: readonly unknown[];
}

interface ExecutionOperationLike {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown, options?: { signal?: AbortSignal }): Promise<ExecutionResultLike>;
}

/** Structurally a glove-execution `BrowserAdapter`. */
export interface BrowserAdapterLike {
  readonly name: string;
  readonly operations: readonly ExecutionOperationLike[];
  resourceIds(): string[];
  uncertainCreations(): number;
  close(): Promise<void>;
}

export interface WithClassifierOptions {
  classifier: ClassifierAdapter;
  /** Name of the added operation. Default `"judge"`. */
  name?: string;
  /** The adapter's observe operation. Default `"observe"`. */
  observe?: string;
  /** Turn an observation into the state to judge. Default: the observation as-is. */
  state?: (observation: unknown, input: Record<string, unknown>) => Entry;
  /**
   * Cap on the state's serialized length; longer observations are truncated
   * (classifier context is finite). Default 100_000 characters.
   */
  maxStateChars?: number;
}

/** Add a `judge` operation (observe → classify → answers only) to a browser adapter. */
export function withClassifier<A extends BrowserAdapterLike>(adapter: A, options: WithClassifierOptions): A {
  const opName = options.name ?? "judge";
  const observeName = options.observe ?? "observe";
  const maxChars = options.maxStateChars ?? 100_000;
  const observe = adapter.operations.find((op) => op.name === observeName);
  if (!observe) {
    throw new Error(`withClassifier: adapter "${adapter.name}" has no "${observeName}" operation to observe pages with`);
  }
  if (adapter.operations.some((op) => op.name === opName)) {
    throw new Error(`withClassifier: adapter "${adapter.name}" already has a "${opName}" operation`);
  }

  const judge: ExecutionOperationLike = {
    name: opName,
    description:
      "Observe a page and judge it with a classifier model. Pass `sessionId` and typed `questions` (noul: yes/no probability; choice: pick a label; score: rate on a rubric). Returns only the answers — the page content is never returned. Any other fields are passed to observe (e.g. `mode`).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        questions: {
          type: "object",
          description: "{ id: { type: 'noul'|'choice'|'score', instructions, criteria } }",
          additionalProperties: { type: "object" },
        },
        mode: { type: "string", enum: ["dom", "accessibility"] },
      },
      required: ["sessionId", "questions"],
      additionalProperties: true,
    },
    async execute(input, control) {
      const { questions, ...observeInput } = (input ?? {}) as Record<string, unknown> & { questions?: Questions };
      try {
        assertValidRequest({ state: "", questions: questions as Questions });
      } catch (err) {
        return { status: "error", error: { code: "invalid_input", message: (err as Error).message } };
      }
      const observed = await observe.execute(observeInput, control);
      if (observed.status === "error") return { status: "error", error: observed.error };
      const raw = options.state ? options.state(observed.data, observeInput) : (observed.data as Entry);
      const state = truncate(raw ?? "", maxChars);
      try {
        const res = await options.classifier.classify(
          { state, questions: questions as Questions },
          { signal: control?.signal },
        );
        return {
          status: "success",
          data: { model: res.model, answers: compactAnswers(res.answers as Record<string, Answer>) },
        };
      } catch (err) {
        if (control?.signal?.aborted) throw err;
        const e = err as { code?: string; message?: string };
        return { status: "error", error: { code: `classifier_${e.code ?? "failed"}`, message: e.message ?? String(err) } };
      }
    },
  };

  const decorated: BrowserAdapterLike = {
    name: adapter.name,
    operations: [...adapter.operations, judge],
    resourceIds: () => adapter.resourceIds(),
    uncertainCreations: () => adapter.uncertainCreations(),
    close: () => adapter.close(),
  };
  return decorated as A;
}

function truncate(state: Entry, max: number): Entry {
  if (typeof state === "string") return state.length > max ? `${state.slice(0, max)}\n…[truncated]` : state;
  const json = JSON.stringify(state);
  return json.length > max ? `${json.slice(0, max)}\n…[truncated]` : state;
}

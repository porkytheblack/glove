/**
 * An LLM behind {@link ClassifierAdapter}.
 *
 * Any Glove `ModelAdapter` can answer the same typed questions a System One
 * model does: it is asked for a probability distribution per question as
 * JSON, and the distribution is turned into the same typed answers (choice,
 * score, noul, confidence). Use it where a dedicated classifier isn't
 * available, as the reasoning fallback in a {@link cascade}, or to compare a
 * classifier against an LLM on your own data.
 *
 * It is slower and costlier than a System One model and its probabilities
 * are self-reported rather than calibrated, so treat its `confidence` as a
 * hint, not a guarantee.
 */
import type { ModelAdapter, NotifySubscribersFunction } from "glove-core/core";
import { answerFromDistribution } from "./answers";
import { ClassifierError } from "./errors";
import { assertValidRequest } from "./questions";
import type {
  Answer,
  ClassifierAdapter,
  ClassifyOptions,
  ClassifyRequest,
  ClassifyResult,
  Description,
  Question,
  Questions,
} from "./types";

export const LLM_CLASSIFIER_SYSTEM_PROMPT = `You are a classifier. You never write prose.

You receive a JSON object with a \`state\` (the content being judged) and \`questions\`, each keyed by an id. Judge every question independently against the state, and reply with ONLY a JSON object of this shape:

{"answers": {"<question id>": {"<option>": <probability>, ...}, ...}}

Each question lists the \`options\` to distribute probability across:
- noul (a yes/no question): options "true" and "false".
- choice: one option per label.
- score: one option per rubric level, "0" (lowest) to "n-1" (highest).

For each question the probabilities are between 0 and 1 and sum to 1. Put probability where you actually believe it: spread it when the state is ambiguous or does not contain enough to decide, and concentrate it only when the answer is clear. Answer every question id. Output the JSON object and nothing else.`;

export interface LLMClassifierOptions {
  /** The model that answers. Keep its `maxTokens` large enough for one JSON object. */
  model: ModelAdapter;
  /** Replace the default system prompt ({@link LLM_CLASSIFIER_SYSTEM_PROMPT}). */
  system?: string;
  /** Adapter name. Default `llm:<model.name>`. */
  name?: string;
  /** Attempts before giving up on an unparseable or incomplete reply. Default 2. */
  maxAttempts?: number;
}

const noNotify: NotifySubscribersFunction = async () => {};

export class LLMClassifier implements ClassifierAdapter {
  readonly name: string;
  private readonly model: ModelAdapter;
  private readonly system: string;
  private readonly maxAttempts: number;
  /** The adapter's system prompt is shared state; calls are serialized through this. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: LLMClassifierOptions) {
    this.model = options.model;
    this.system = options.system ?? LLM_CLASSIFIER_SYSTEM_PROMPT;
    this.name = options.name ?? `llm:${options.model.name}`;
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 2));
  }

  classify<Q extends Questions>(
    request: ClassifyRequest<Q>,
    options: ClassifyOptions = {},
  ): Promise<ClassifyResult<Q>> {
    assertValidRequest(request);
    const run = this.queue.then(() => this.run(request, options.signal));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run<Q extends Questions>(
    request: ClassifyRequest<Q>,
    signal: AbortSignal | undefined,
  ): Promise<ClassifyResult<Q>> {
    const prompt = JSON.stringify({
      state: request.state,
      questions: Object.fromEntries(
        Object.entries(request.questions).map(([id, q]) => [id, describeQuestion(q)]),
      ),
    });

    let tokensIn = 0;
    let tokensOut = 0;
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      this.model.setSystemPrompt(this.system);
      const res = await this.model.prompt({ messages: [{ sender: "user", text: prompt }] }, noNotify, signal);
      tokensIn += res.tokens_in ?? 0;
      tokensOut += res.tokens_out ?? 0;
      const text = res.messages?.map((m) => m.text ?? "").join("") ?? "";
      try {
        const answers = parseAnswers(text, request.questions);
        return {
          model: this.model.name,
          answers,
          usage: { input_tokens: tokensIn, output_tokens: tokensOut },
        };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof ClassifierError
      ? lastError
      : new ClassifierError("bad_response", "model reply could not be parsed", { cause: lastError });
  }
}

/** Wrap a Glove `ModelAdapter` as a classifier. */
export function llmClassifier(options: LLMClassifierOptions): LLMClassifier {
  return new LLMClassifier(options);
}

// ─── Prompt and parsing ──────────────────────────────────────────────────────

function describeQuestion(q: Question): Record<string, unknown> {
  let options: Record<string, Description>;
  switch (q.type) {
    case "noul":
      options = { true: q.criteria?.true ?? "yes", false: q.criteria?.false ?? "no" };
      break;
    case "choice":
      options = q.criteria;
      break;
    case "score":
      options = Object.fromEntries(q.criteria.map((d, i) => [String(i), d]));
      break;
  }
  return { type: q.type, instructions: q.instructions ?? null, options };
}

/** Parse a reply into typed answers; throws `bad_response` when any question is unanswered. */
export function parseAnswers<Q extends Questions>(text: string, questions: Q): ClassifyResult<Q>["answers"] {
  const parsed = extractJson(text);
  const root = (parsed && typeof parsed === "object" && "answers" in parsed
    ? (parsed as { answers: unknown }).answers
    : parsed) as Record<string, unknown> | null;
  if (!root || typeof root !== "object") {
    throw new ClassifierError("bad_response", "model reply is not a JSON object", { body: text });
  }
  const answers: Record<string, Answer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const raw = root[id];
    const dist = toDistribution(raw);
    if (!dist) {
      throw new ClassifierError("bad_response", `model reply has no distribution for "${id}"`, { body: text });
    }
    answers[id] = answerFromDistribution(question, dist);
  }
  return answers as ClassifyResult<Q>["answers"];
}

function toDistribution(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const source = (raw as { probabilities?: unknown }).probabilities ?? raw;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(source)) {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new ClassifierError("bad_response", "model reply contains no JSON object", { body: text });
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (err) {
    throw new ClassifierError("bad_response", "model reply is not valid JSON", { body: text, cause: err });
  }
}

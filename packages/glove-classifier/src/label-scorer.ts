/**
 * Zero-shot label scorers as classifiers.
 *
 * An older family of classifier models does one narrower thing: given a text
 * and candidate labels, it returns a score per label. NLI models like
 * `facebook/bart-large-mnli` work this way, and so do GLiClass and fine-tuned
 * SetFit heads. They don't take instructions, but they are small, fast and
 * easy to self-host.
 *
 * {@link labelScorer} maps the three question types onto "score these labels":
 *
 * - **noul**: the question text is the hypothesis, scored on its own
 *   (multi-label). If the criteria describe both yes and no, the two
 *   descriptions are scored against each other.
 * - **choice**: each label is scored, as `"label: description"` when a
 *   description exists, and the scores are normalized into a distribution.
 * - **score**: each level's description is scored, normalized, and the level
 *   is the expected index.
 *
 * Choice and score instructions are not sent. These models only see labels,
 * so put the meaning in the labels and descriptions.
 */
import { answerFromDistribution } from "./answers";
import { ClassifierError } from "./errors";
import { assertValidRequest } from "./questions";
import { env } from "./systemone";
import type {
  Answer,
  ClassifierAdapter,
  ClassifyOptions,
  ClassifyRequest,
  ClassifyResult,
  Description,
  Entry,
  Question,
  Questions,
} from "./types";

export interface LabelScoreRequest {
  text: string;
  labels: string[];
  /** true: score each label independently (0–1 each). false: labels compete. */
  multiLabel: boolean;
  signal?: AbortSignal;
}

export interface LabelScorerOptions {
  name: string;
  /** Score every label for one text. Return one number per label, in the same order. */
  score(request: LabelScoreRequest): Promise<number[]>;
  /** How a state becomes text. Default: strings as-is, anything else as JSON. */
  toText?: (state: Entry) => string;
  /** Parallel requests across questions. Default 4. */
  concurrency?: number;
}

export class LabelScorerClassifier implements ClassifierAdapter {
  readonly name: string;
  private readonly options: LabelScorerOptions;

  constructor(options: LabelScorerOptions) {
    this.name = options.name;
    this.options = options;
  }

  async classify<Q extends Questions>(request: ClassifyRequest<Q>, opts: ClassifyOptions = {}): Promise<ClassifyResult<Q>> {
    assertValidRequest(request);
    const text = (this.options.toText ?? defaultToText)(request.state);
    const entries = Object.entries(request.questions);
    const answers: Record<string, Answer> = {};
    let next = 0;
    const worker = async () => {
      while (next < entries.length) {
        const [id, question] = entries[next++]!;
        answers[id] = await this.answer(text, question, opts.signal);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.options.concurrency ?? 4, entries.length) }, worker));
    return { model: this.name, answers: answers as ClassifyResult<Q>["answers"], usage: { input_tokens: 0, output_tokens: 0 } };
  }

  private async answer(text: string, question: Question, signal?: AbortSignal): Promise<Answer> {
    const run = async (labels: string[], multiLabel: boolean) => {
      const scores = await this.options.score({ text, labels, multiLabel, signal });
      if (!Array.isArray(scores) || scores.length !== labels.length) {
        throw new ClassifierError("bad_response", `${this.name} returned ${scores?.length ?? 0} scores for ${labels.length} labels`);
      }
      return scores;
    };
    switch (question.type) {
      case "noul": {
        const yes = question.criteria?.true;
        const no = question.criteria?.false;
        if (yes != null && no != null) {
          const [py, pn] = await run([asText(yes), asText(no)], false);
          return answerFromDistribution(question, { true: py!, false: pn! });
        }
        const statement = asText(question.instructions ?? yes ?? "");
        if (!statement) throw new ClassifierError("invalid_request", "a yes/no question needs instructions for a label scorer");
        const [p] = await run([statement], true);
        return answerFromDistribution(question, { true: p! });
      }
      case "choice": {
        const labels = Object.keys(question.criteria);
        const scores = await run(labels.map((l) => labelText(l, question.criteria[l])), false);
        return answerFromDistribution(question, Object.fromEntries(labels.map((l, i) => [l, scores[i]!])));
      }
      case "score": {
        const scores = await run(question.criteria.map((d, i) => (d == null ? `level ${i}` : asText(d))), false);
        return answerFromDistribution(question, Object.fromEntries(scores.map((s, i) => [String(i), s])));
      }
    }
  }
}

/** Wrap any "text + labels → scores" model as a classifier. */
export function labelScorer(options: LabelScorerOptions): LabelScorerClassifier {
  return new LabelScorerClassifier(options);
}

// ─── Hugging Face zero-shot classification ───────────────────────────────────

export interface HuggingFaceZeroShotOptions {
  /** Model id. Default `facebook/bart-large-mnli`. */
  model?: string;
  /** Falls back to `HF_TOKEN`, then `HUGGINGFACE_API_KEY`. Required for the hosted API. */
  apiKey?: string;
  /**
   * Endpoint root. Default: the hosted Inference Providers router
   * (`https://router.huggingface.co/hf-inference/models`). For a dedicated
   * Inference Endpoint, pass its URL and `modelInPath: false`.
   */
  baseURL?: string;
  /** Append `/<model>` to baseURL. Default true. */
  modelInPath?: boolean;
  /** NLI hypothesis template. Default "This example is {}." */
  hypothesisTemplate?: string;
  timeout?: number;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/** A Hugging Face zero-shot classification model (NLI) as a classifier. */
export function huggingfaceZeroShot(options: HuggingFaceZeroShotOptions = {}): LabelScorerClassifier {
  const model = options.model ?? "facebook/bart-large-mnli";
  const apiKey = options.apiKey ?? env("HF_TOKEN") ?? env("HUGGINGFACE_API_KEY");
  const root = (options.baseURL ?? "https://router.huggingface.co/hf-inference/models").replace(/\/+$/, "");
  const url = options.modelInPath === false ? root : `${root}/${model}`;
  const doFetch = options.fetch ?? globalThis.fetch;
  return labelScorer({
    name: `huggingface:${model}`,
    async score({ text, labels, multiLabel, signal }) {
      const body = await postJson(doFetch, url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        payload: {
          inputs: text,
          parameters: {
            candidate_labels: labels,
            multi_label: multiLabel,
            ...(options.hypothesisTemplate && { hypothesis_template: options.hypothesisTemplate }),
          },
        },
        timeout: options.timeout ?? 30_000,
        signal,
        provider: "huggingface",
      });
      return scoresFor(labels, body);
    },
  });
}

// ─── GLiClass ────────────────────────────────────────────────────────────────

export interface GLiClassOptions {
  /** Server root from `python -m gliclass.serve`. Default `http://localhost:8000`. Reads `GLICLASS_BASE_URL`. */
  baseURL?: string;
  /** Label for `name`; the server decides which checkpoint it runs. */
  model?: string;
  timeout?: number;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/** A GLiClass server (Knowledgator's zero-shot sequence classifier) as a classifier. */
export function gliclass(options: GLiClassOptions = {}): LabelScorerClassifier {
  const root = (options.baseURL ?? env("GLICLASS_BASE_URL") ?? "http://localhost:8000").replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;
  return labelScorer({
    name: `gliclass:${options.model ?? "server"}`,
    async score({ text, labels, signal }) {
      // GLiClass scores labels independently (sigmoid). threshold 0 returns every label.
      const body = await postJson(doFetch, `${root}/gliclass`, {
        payload: { texts: text, labels, threshold: 0 },
        timeout: options.timeout ?? 30_000,
        signal,
        provider: "gliclass",
      });
      return scoresFor(labels, body);
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read per-label scores from the common response shapes: `[{ label, score }]`,
 * `{ labels: [...], scores: [...] }`, or either wrapped in an outer array.
 * Labels the model left out score 0.
 */
export function scoresFor(labels: string[], body: unknown): number[] {
  let rows: Array<{ label: string; score: number }> | undefined;
  const unwrap = Array.isArray(body) && body.length === 1 && (Array.isArray(body[0]) || (body[0] as { labels?: unknown })?.labels) ? body[0] : body;
  if (Array.isArray(unwrap)) rows = unwrap as Array<{ label: string; score: number }>;
  else if (unwrap && typeof unwrap === "object" && Array.isArray((unwrap as { labels?: unknown }).labels)) {
    const u = unwrap as { labels: string[]; scores: number[] };
    rows = u.labels.map((label, i) => ({ label, score: u.scores[i] ?? 0 }));
  }
  if (!rows) throw new ClassifierError("bad_response", "label scorer returned no label scores", { body });
  const byLabel = new Map(rows.map((r) => [r.label, typeof r.score === "number" ? r.score : 0]));
  return labels.map((l) => byLabel.get(l) ?? 0);
}

async function postJson(
  doFetch: (input: string, init?: RequestInit) => Promise<Response>,
  url: string,
  o: { payload: unknown; headers?: Record<string, string>; timeout: number; signal?: AbortSignal; provider: string },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeout);
  const onAbort = () => controller.abort();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...o.headers },
      body: JSON.stringify(o.payload),
      signal: controller.signal,
    });
    const text = await res.text();
    const body = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const code = res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate_limited" : res.status < 500 ? "invalid_request" : "provider";
      throw new ClassifierError(code, `${o.provider} request failed (${res.status})${text ? `: ${text.slice(0, 300)}` : ""}`, { status: res.status, body });
    }
    return body;
  } catch (err) {
    if (err instanceof ClassifierError) throw err;
    if (o.signal?.aborted) throw err;
    throw new ClassifierError("connection", `${o.provider} request to ${url} failed: ${(err as Error).message}`, { cause: err });
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function defaultToText(state: Entry): string {
  return typeof state === "string" ? state : JSON.stringify(state);
}

function asText(d: Description): string {
  return d == null ? "" : typeof d === "string" ? d : JSON.stringify(d);
}

function labelText(label: string, description: Description | undefined): string {
  const name = label.replace(/[_-]+/g, " ");
  return description == null ? name : `${name}: ${asText(description)}`;
}

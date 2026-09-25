/**
 * Any model that speaks TypeSafe's System One wire format.
 *
 * `POST /v1/systemone` with `{ state, model, questions }` has become the
 * de facto interface for typed-decision models. TypeSafe's hosted Jev defined
 * it, and open models serve it too: Kev, Laya, Von, Rizzo Flow and Decider,
 * among others. {@link SystemOneClassifier} is the shared client. `jev()` and
 * the open-model presets in `./open-models` are this class with different
 * defaults.
 *
 * Servers differ in small ways, and the client absorbs them:
 *
 * - **API key.** Hosted APIs need one. Local servers usually don't, or take
 *   one only when you set it. `requireApiKey` decides whether a missing key
 *   is an error.
 * - **Response fields.** Some servers omit `confidence`, `legend`, `usage`
 *   or `model`. Missing confidence is computed from the probabilities,
 *   missing legends come from the question, and missing usage counts as
 *   zero. Extra fields (`latency_ms`, `routing`, `x_rizzo`, …) are ignored.
 * - **Limits.** Servers accept different numbers of options. `limits`
 *   rejects a question locally, with a message naming the limit, instead of
 *   letting the server fail it.
 */
import { AbortError } from "glove-core/core";
import { answerFromDistribution, distributionConfidence } from "./answers";
import { ClassifierError } from "./errors";
import { assertValidRequest } from "./questions";
import type {
  Answer,
  ClassifierAdapter,
  ClassifyOptions,
  ClassifyRequest,
  ClassifyResult,
  Question,
  Questions,
} from "./types";

export type SystemOneFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What a particular server accepts. Checked locally before a request is sent. */
export interface SystemOneLimits {
  /** Most labels a choice may have. */
  maxChoiceOptions?: number;
  /** Most levels a score may have. */
  maxScoreLevels?: number;
  /** The server rejects a score level whose description is null. */
  scoreLevelsNeedDescriptions?: boolean;
}

export interface SystemOneOptions {
  /** Server root, e.g. `http://127.0.0.1:8009`. `/v1/systemone` is appended. */
  baseURL: string;
  /** Model id sent with every request (a per-call `model` overrides it). */
  model: string;
  /** Bearer token. Omit for servers without auth. */
  apiKey?: string;
  /** Throw at construction when no API key is available. Default false. */
  requireApiKey?: boolean;
  /** Human-readable provider name used in errors and `name`. Default "system-one". */
  provider?: string;
  limits?: SystemOneLimits;
  /** Per-attempt timeout in ms. Default 10000; local CPU servers may need more. */
  timeout?: number;
  /** Retries after the first attempt. Default 2; 0 disables. */
  maxRetries?: number;
  /** First backoff delay in ms, doubled per retry up to 5000. Default 500. */
  backoffMs?: number;
  /** Extra headers on every request (auth and content type can't be overridden). */
  headers?: Record<string, string>;
  /** Custom fetch, for tests or transport configuration. Default: global `fetch`. */
  fetch?: SystemOneFetch;
}

export interface SystemOneModelCard {
  name: string;
  description?: string;
  release_date?: string;
}

const MAX_BACKOFF_MS = 5_000;
const MAX_RETRY_AFTER_MS = 60_000;

export class SystemOneClassifier implements ClassifierAdapter {
  readonly name: string;
  readonly model: string;
  readonly baseURL: string;
  readonly provider: string;
  readonly limits: SystemOneLimits;
  private readonly apiKey?: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: SystemOneFetch;

  constructor(options: SystemOneOptions) {
    this.provider = options.provider ?? "system-one";
    if (!options.baseURL) {
      throw new ClassifierError("invalid_request", `${this.provider}: baseURL is required`);
    }
    if (options.requireApiKey && !options.apiKey) {
      throw new ClassifierError("auth", `No API key for ${this.provider}. Pass apiKey or set its env var.`);
    }
    this.apiKey = options.apiKey || undefined;
    this.baseURL = options.baseURL.replace(/\/+$/, "");
    this.model = options.model;
    this.name = `${this.provider}:${this.model}`;
    this.limits = options.limits ?? {};
    this.timeout = options.timeout ?? 10_000;
    this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 2));
    this.backoffMs = options.backoffMs ?? 500;
    this.headers = options.headers ?? {};
    const f = options.fetch ?? (globalThis.fetch as SystemOneFetch | undefined);
    if (!f) throw new ClassifierError("connection", "No fetch implementation available; pass options.fetch");
    this.fetchImpl = f;
  }

  async classify<Q extends Questions>(
    request: ClassifyRequest<Q>,
    options: ClassifyOptions = {},
  ): Promise<ClassifyResult<Q>> {
    assertValidRequest(request);
    this.assertWithinLimits(request.questions);
    const model = request.model ?? this.model;
    const body = await this.send("POST", "/v1/systemone", { state: request.state, model, questions: request.questions }, options.signal);
    return parseSystemOneResult(body, request.questions, { provider: this.provider, model });
  }

  /** Models the server lists at `GET /v1/models` (not every server has this endpoint). */
  async listModels(options: ClassifyOptions = {}): Promise<SystemOneModelCard[]> {
    const body = (await this.send("GET", "/v1/models", undefined, options.signal)) as {
      models?: SystemOneModelCard[];
      data?: Array<{ id: string }>;
    };
    if (Array.isArray(body?.models)) return body.models;
    if (Array.isArray(body?.data)) return body.data.map((m) => ({ name: m.id }));
    return [];
  }

  private assertWithinLimits(questions: Questions): void {
    const { maxChoiceOptions, maxScoreLevels, scoreLevelsNeedDescriptions } = this.limits;
    for (const [id, q] of Object.entries(questions)) {
      const fail = (why: string) => {
        throw new ClassifierError("invalid_request", `question "${id}": ${this.provider} ${why}`);
      };
      if (q.type === "choice" && maxChoiceOptions !== undefined) {
        const n = Object.keys(q.criteria).length;
        if (n > maxChoiceOptions) fail(`accepts at most ${maxChoiceOptions} choice labels (got ${n})`);
      }
      if (q.type === "score") {
        if (maxScoreLevels !== undefined && q.criteria.length > maxScoreLevels) {
          fail(`accepts at most ${maxScoreLevels} score levels (got ${q.criteria.length})`);
        }
        if (scoreLevelsNeedDescriptions && q.criteria.some((level) => level == null)) {
          fail("needs a description for every score level");
        }
      }
    }
  }

  private async send(method: "GET" | "POST", path: string, payload: unknown, signal: AbortSignal | undefined): Promise<unknown> {
    const url = `${this.baseURL}${path}`;
    const headers: Record<string, string> = {
      ...this.headers,
      Accept: "application/json",
      ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      ...(payload !== undefined && { "Content-Type": "application/json" }),
    };
    const init: RequestInit = { method, headers, ...(payload !== undefined && { body: JSON.stringify(payload) }) };

    for (let attempt = 0; ; attempt++) {
      throwIfAborted(signal);
      const retriesLeft = this.maxRetries - attempt;
      let res: Response;
      try {
        res = await this.fetchWithTimeout(url, init, signal);
      } catch (err) {
        if (signal?.aborted) throw new AbortError();
        if (retriesLeft > 0) {
          await sleep(this.backoff(attempt), signal);
          continue;
        }
        throw err instanceof ClassifierError
          ? err
          : new ClassifierError("connection", `${this.provider} request to ${url} failed: ${describe(err)}`, { cause: err });
      }
      if (res.ok) {
        try {
          return await res.json();
        } catch (err) {
          throw new ClassifierError("bad_response", `${this.provider} returned a non-JSON body`, { status: res.status, cause: err });
        }
      }
      const errorBody = await readBody(res);
      if (retriesLeft > 0 && isRetryable(res.status)) {
        await sleep(this.retryDelay(res, attempt), signal);
        continue;
      }
      throw httpError(this.provider, res.status, errorBody);
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit, signal: AbortSignal | undefined): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeout);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (timedOut) {
        throw new ClassifierError("connection", `${this.provider} request timed out after ${this.timeout}ms`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private backoff(attempt: number): number {
    const base = Math.min(this.backoffMs * 2 ** attempt, MAX_BACKOFF_MS);
    return base - Math.random() * base * 0.25;
  }

  private retryDelay(res: Response, attempt: number): number {
    const ms = Number(res.headers.get("retry-after-ms"));
    if (Number.isFinite(ms) && ms >= 0 && res.headers.has("retry-after-ms")) return Math.min(ms, MAX_RETRY_AFTER_MS);
    const after = res.headers.get("retry-after");
    if (after) {
      const seconds = Number(after);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(after) - Date.now();
      if (Number.isFinite(delay) && delay >= 0 && delay <= MAX_RETRY_AFTER_MS) return delay;
    }
    return this.backoff(attempt);
  }
}

/** A classifier for any `/v1/systemone`-compatible server. */
export function systemOne(options: SystemOneOptions): SystemOneClassifier {
  return new SystemOneClassifier(options);
}

// ─── Response parsing ────────────────────────────────────────────────────────

/**
 * Turn a `/v1/systemone` response into typed answers, filling what a server
 * left out (confidence, legend, usage, model) and rejecting what is missing.
 */
export function parseSystemOneResult<Q extends Questions>(
  body: unknown,
  questions: Q,
  context: { provider: string; model: string },
): ClassifyResult<Q> {
  const b = body as { model?: unknown; answers?: Record<string, unknown>; usage?: Record<string, unknown> };
  if (!b || typeof b !== "object" || !b.answers || typeof b.answers !== "object") {
    throw new ClassifierError("bad_response", `${context.provider} response has no \`answers\``, { body });
  }
  const answers: Record<string, Answer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = normalizeAnswer(question, b.answers[id]);
    if (!answer) {
      throw new ClassifierError("bad_response", `${context.provider} response is missing a ${question.type} answer for "${id}"`, { body });
    }
    answers[id] = answer;
  }
  return {
    model: typeof b.model === "string" && b.model ? b.model : context.model,
    answers: answers as ClassifyResult<Q>["answers"],
    usage: { input_tokens: numberOr0(b.usage?.input_tokens), output_tokens: numberOr0(b.usage?.output_tokens) },
  };
}

function normalizeAnswer(question: Question, raw: unknown): Answer | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  if (a.type !== undefined && a.type !== question.type) return undefined;
  switch (question.type) {
    case "noul":
      return typeof a.noul === "number" ? { type: "noul", noul: a.noul } : undefined;
    case "choice": {
      const probabilities = numberMap(a.probabilities);
      if (!probabilities) {
        // A server that returns only the label: treat it as certain.
        return typeof a.choice === "string" ? answerFromDistribution(question, { [a.choice]: 1 }) : undefined;
      }
      const labels = Object.keys(question.criteria);
      const choice = typeof a.choice === "string" ? a.choice : labels.reduce((best, l) => ((probabilities[l] ?? 0) > (probabilities[best] ?? 0) ? l : best), labels[0]!);
      return {
        type: "choice",
        choice,
        probabilities,
        confidence: typeof a.confidence === "number" ? a.confidence : distributionConfidence(labels.map((l) => probabilities[l] ?? 0)),
      };
    }
    case "score": {
      const probabilities = numberMap(a.probabilities);
      if (!probabilities && typeof a.score !== "number") return undefined;
      const levels = question.criteria.map((_, i) => probabilities?.[String(i)] ?? 0);
      const legend = (a.legend && typeof a.legend === "object"
        ? a.legend
        : Object.fromEntries(question.criteria.map((d, i) => [String(i), d]))) as Record<string, string>;
      return {
        type: "score",
        score: typeof a.score === "number" ? a.score : levels.reduce((s, p, i) => s + p * i, 0),
        legend,
        probabilities: (probabilities ?? {}) as Record<string, number>,
        confidence: typeof a.confidence === "number" ? a.confidence : probabilities ? distributionConfidence(levels) : 0,
      } as Answer;
    }
  }
}

function numberMap(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) if (typeof n === "number") out[k] = n;
  return Object.keys(out).length ? out : undefined;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function httpError(provider: string, status: number, body: unknown): ClassifierError {
  const detail = errorDetail(body);
  const suffix = detail ? `: ${detail}` : "";
  if (status === 401 || status === 403) {
    return new ClassifierError("auth", `${provider} rejected the API key (${status})${suffix}`, { status, body });
  }
  if (status === 429 || status === 529) {
    return new ClassifierError("rate_limited", `${provider} is rate limiting or overloaded (${status})${suffix}`, { status, body });
  }
  if (status === 400 || status === 413 || status === 422) {
    return new ClassifierError("invalid_request", `${provider} rejected the request (${status})${suffix}`, { status, body });
  }
  return new ClassifierError("provider", `${provider} request failed (${status})${suffix}`, { status, body });
}

function errorDetail(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 500);
  if (body && typeof body === "object") {
    const b = body as { detail?: unknown; message?: unknown; error?: unknown };
    const d = b.detail ?? b.message ?? b.error;
    if (typeof d === "string") return d;
    if (d !== undefined) return JSON.stringify(d).slice(0, 500);
  }
  return "";
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AbortError();
}

export function env(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env?.[name]?.trim() : undefined;
  return value ? value : undefined;
}

function numberOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

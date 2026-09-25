/**
 * TypeSafe System One adapter — Jev behind {@link ClassifierAdapter}.
 *
 * Jev is not a chat model and cannot sit behind a Glove `ModelAdapter`: it
 * takes a state and typed questions and returns calibrated, typed answers in
 * one parallel pass (70–500 ms, input-token pricing, output free). This
 * adapter speaks `POST /v1/systemone` directly with `fetch` — no SDK
 * dependency — and mirrors the official SDK's conventions: the same env vars,
 * the `jev-latest` default, per-attempt timeouts, and retries with backoff on
 * 408 / 429 / 5xx (including 529 Overloaded) that honour `Retry-After`.
 *
 * Docs: https://docs.typesafe.ai/api
 */
import { AbortError } from "glove-core/core";
import { ClassifierError } from "./errors";
import { assertValidRequest } from "./questions";
import type {
  Answer,
  ClassifierAdapter,
  ClassifyOptions,
  ClassifyRequest,
  ClassifyResult,
  Questions,
} from "./types";

export const TYPESAFE_DEFAULT_BASE_URL = "https://api.typesafe.ai";
/** Most recent stable Jev release. Moves when a new version ships. */
export const JEV_LATEST = "jev-latest";
/** Most recent Jev build, official or preview. */
export const JEV_PREVIEW = "jev-preview";

export type TypeSafeFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface TypeSafeOptions {
  /** Falls back to `TYPESAFE_API_KEY`. */
  apiKey?: string;
  /** Falls back to `TYPESAFE_BASE_URL`, then `https://api.typesafe.ai`. */
  baseURL?: string;
  /**
   * Default model; falls back to `TYPESAFE_DEFAULT_MODEL`, then `jev-latest`.
   * Pin a versioned id (e.g. `jev-1.13.0`) when you have tuned confidence
   * thresholds against it — aliases move on release.
   */
  model?: string;
  /** Per-attempt timeout in ms. Default 10000. */
  timeout?: number;
  /** Retries after the first attempt. Default 2; 0 disables. */
  maxRetries?: number;
  /** First backoff delay in ms, doubled per retry up to 5000. Default 500. */
  backoffMs?: number;
  /** Extra headers on every request (auth and content type can't be overridden). */
  headers?: Record<string, string>;
  /** Custom fetch, for tests or transport configuration. Default: global `fetch`. */
  fetch?: TypeSafeFetch;
}

export interface TypeSafeModelCard {
  name: string;
  description: string;
  release_date: string;
}

const MAX_BACKOFF_MS = 5_000;
const MAX_RETRY_AFTER_MS = 60_000;

export class TypeSafeClassifier implements ClassifierAdapter {
  readonly name: string;
  readonly model: string;
  readonly baseURL: string;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: TypeSafeFetch;

  constructor(options: TypeSafeOptions = {}) {
    const apiKey = options.apiKey ?? env("TYPESAFE_API_KEY");
    if (!apiKey) {
      throw new ClassifierError(
        "auth",
        "No TypeSafe API key. Set TYPESAFE_API_KEY or pass apiKey (get one at https://console.typesafe.ai/keys).",
      );
    }
    this.apiKey = apiKey;
    this.baseURL = (options.baseURL ?? env("TYPESAFE_BASE_URL") ?? TYPESAFE_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = options.model ?? env("TYPESAFE_DEFAULT_MODEL") ?? JEV_LATEST;
    this.name = `typesafe:${this.model}`;
    this.timeout = options.timeout ?? 10_000;
    this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 2));
    this.backoffMs = options.backoffMs ?? 500;
    this.headers = options.headers ?? {};
    const f = options.fetch ?? (globalThis.fetch as TypeSafeFetch | undefined);
    if (!f) throw new ClassifierError("connection", "No fetch implementation available; pass options.fetch");
    this.fetchImpl = f;
  }

  async classify<Q extends Questions>(
    request: ClassifyRequest<Q>,
    options: ClassifyOptions = {},
  ): Promise<ClassifyResult<Q>> {
    assertValidRequest(request);
    const payload = {
      state: request.state,
      model: request.model ?? this.model,
      questions: request.questions,
    };
    const body = await this.send("POST", "/v1/systemone", payload, options.signal);
    return parseResult(body, request.questions);
  }

  /** Model ids and aliases this account can send in `model`. */
  async listModels(options: ClassifyOptions = {}): Promise<TypeSafeModelCard[]> {
    const body = (await this.send("GET", "/v1/models", undefined, options.signal)) as {
      models?: TypeSafeModelCard[];
    };
    return Array.isArray(body?.models) ? body.models : [];
  }

  private async send(
    method: "GET" | "POST",
    path: string,
    payload: unknown,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const url = `${this.baseURL}${path}`;
    const headers: Record<string, string> = {
      ...this.headers,
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      ...(payload !== undefined && { "Content-Type": "application/json" }),
    };
    const init: RequestInit = {
      method,
      headers,
      ...(payload !== undefined && { body: JSON.stringify(payload) }),
    };

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
        const timedOut = err instanceof ClassifierError;
        throw timedOut
          ? err
          : new ClassifierError("connection", `TypeSafe request failed: ${describe(err)}`, { cause: err });
      }

      if (res.ok) {
        try {
          return await res.json();
        } catch (err) {
          throw new ClassifierError("bad_response", "TypeSafe returned a non-JSON body", {
            status: res.status,
            cause: err,
          });
        }
      }

      const errorBody = await readBody(res);
      if (retriesLeft > 0 && isRetryable(res.status)) {
        await sleep(this.retryDelay(res, attempt), signal);
        continue;
      }
      throw httpError(res.status, errorBody);
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
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
        throw new ClassifierError("connection", `TypeSafe request timed out after ${this.timeout}ms`, {
          cause: err,
        });
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
    if (Number.isFinite(ms) && ms >= 0 && res.headers.has("retry-after-ms")) {
      return Math.min(ms, MAX_RETRY_AFTER_MS);
    }
    const after = res.headers.get("retry-after");
    if (after) {
      const seconds = Number(after);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(after) - Date.now();
      if (Number.isFinite(delay) && delay >= 0 && delay <= MAX_RETRY_AFTER_MS) return delay;
    }
    return this.backoff(attempt);
  }
}

/** A TypeSafe System One classifier. Reads `TYPESAFE_API_KEY` by default. */
export function typesafe(options: TypeSafeOptions = {}): TypeSafeClassifier {
  return new TypeSafeClassifier(options);
}

/** Jev, TypeSafe's flagship System One model. Same as {@link typesafe}; defaults to `jev-latest`. */
export function jev(options: TypeSafeOptions = {}): TypeSafeClassifier {
  return new TypeSafeClassifier(options);
}

// ─── Response parsing ────────────────────────────────────────────────────────

function parseResult<Q extends Questions>(body: unknown, questions: Q): ClassifyResult<Q> {
  const b = body as { model?: unknown; answers?: Record<string, unknown>; usage?: Record<string, unknown> };
  if (!b || typeof b !== "object" || !b.answers || typeof b.answers !== "object") {
    throw new ClassifierError("bad_response", "TypeSafe response has no `answers`", { body });
  }
  const answers: Record<string, Answer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = b.answers[id] as Answer | undefined;
    if (!answer || typeof answer !== "object" || answer.type !== question.type) {
      throw new ClassifierError(
        "bad_response",
        `TypeSafe response is missing a ${question.type} answer for "${id}"`,
        { body },
      );
    }
    answers[id] = answer;
  }
  return {
    model: typeof b.model === "string" ? b.model : "",
    answers: answers as ClassifyResult<Q>["answers"],
    usage: {
      input_tokens: numberOr0(b.usage?.input_tokens),
      output_tokens: numberOr0(b.usage?.output_tokens),
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function httpError(status: number, body: unknown): ClassifierError {
  const detail = errorDetail(body);
  const suffix = detail ? `: ${detail}` : "";
  if (status === 401 || status === 403) {
    return new ClassifierError("auth", `TypeSafe rejected the API key (${status})${suffix}`, { status, body });
  }
  if (status === 429 || status === 529) {
    return new ClassifierError("rate_limited", `TypeSafe is rate limiting or overloaded (${status})${suffix}`, {
      status,
      body,
    });
  }
  if (status === 400 || status === 422) {
    return new ClassifierError("invalid_request", `TypeSafe rejected the request (${status})${suffix}`, {
      status,
      body,
    });
  }
  return new ClassifierError("provider", `TypeSafe request failed (${status})${suffix}`, { status, body });
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

function env(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env?.[name]?.trim() : undefined;
  return value ? value : undefined;
}

function numberOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

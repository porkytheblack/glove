/**
 * An HTTP toolkit for provider authors. Optional — base never calls it.
 *
 * Most backends worth writing a provider for are REST APIs behind a token,
 * and every one of those providers otherwise rewrites the same four things:
 * a bearer header, a timeout, a retry that honours `Retry-After`, and a
 * cursor loop. Two of those are easy to get subtly wrong, and one of them —
 * the cursor loop — is wrong in the way that returns a plausible answer
 * computed from the first page.
 *
 * ```ts
 * const http = createHttpClient({
 *   baseUrl: "https://api.example.com/v1",
 *   headers: () => ({ Authorization: `Bearer ${token}` }),
 * });
 *
 * const doc = await http.request("GET", `/docs/${id}`);
 * const all = await http.collect("GET", "/docs", {
 *   items: (body) => body.results,
 *   next: (body) => body.next_cursor ?? undefined,
 * });
 * ```
 */

/** The subset of `fetch` this uses. Inject one in tests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpOptions {
  /** Everything is resolved against this. */
  baseUrl: string;
  /**
   * Headers per request. A function is called each time, so a refreshing
   * token needs no client rebuild.
   */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  fetch?: FetchLike;
  /** Retries for 429 and the transient 5xx family. Default 3. */
  maxRetries?: number;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /**
   * Pages any one `collect` will walk. Default 50. A cap, not a limit:
   * exceeding it throws, because a silently truncated result set is the
   * failure that reads as a correct answer.
   */
  maxPages?: number;
  /** Injected in tests so backoff costs no wall clock. */
  sleep?: (ms: number) => Promise<void>;
  /** Turn a failed response body into a message. Default: its `message` field. */
  describeError?: (status: number, body: unknown) => string | undefined;
}

/** An HTTP failure, with the status and any code the body carried. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(message: string, status: number, code: string, body: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export interface CollectSpec<T> {
  /** Pull the page of items out of a response body. */
  items: (body: any) => T[] | undefined;
  /** The cursor for the next page, or undefined when there is none. */
  next: (body: any) => string | undefined;
  /** Put the cursor back. Default: a `cursor` query parameter (GET) or field (POST). */
  withCursor?: (cursor: string) => { query?: Record<string, string>; body?: Record<string, unknown> };
  /** Stop at this many items. */
  limit?: number;
  /** Extra body for a POST-style list endpoint. */
  body?: Record<string, unknown>;
  /** Extra query parameters. */
  query?: Record<string, string>;
}

export interface HttpClient {
  request<T = unknown>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T>;
  /** Walk every page of a list endpoint. */
  collect<T = unknown>(method: "GET" | "POST", path: string, spec: CollectSpec<T>): Promise<T[]>;
}

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function createHttpClient(options: HttpOptions): HttpClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const ambient = globalThis.fetch;
  const doFetch = options.fetch ?? ((url: string, init: RequestInit) => ambient(url, init));
  if (typeof doFetch !== "function") {
    throw new Error("createHttpClient: no fetch available — pass one on a runtime without a global fetch");
  }
  const maxRetries = Math.max(0, options.maxRetries ?? 3);
  const timeoutMs = Math.max(1000, options.timeoutMs ?? 30_000);
  const maxPages = Math.max(1, options.maxPages ?? 50);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const resolveHeaders = async (): Promise<Record<string, string>> => {
    const headers = typeof options.headers === "function" ? await options.headers() : (options.headers ?? {});
    return { Accept: "application/json", ...headers };
  };

  const request = async <T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T> => {
    const search = query && Object.keys(query).length > 0 ? `?${new URLSearchParams(query)}` : "";
    const url = `${baseUrl}/${String(path).replace(/^\/+/, "")}${search}`;

    let lastRetryAfter: number | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(backoff(attempt, lastRetryAfter));
      lastRetryAfter = undefined;

      const headers = await resolveHeaders();
      const init: RequestInit = { method: method.toUpperCase(), headers, signal: AbortSignal.timeout(timeoutMs) };
      if (body !== undefined) {
        (headers as Record<string, string>)["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }

      let response: Response;
      try {
        response = await doFetch(url, init);
      } catch (error) {
        // A network failure or a timeout. Worth naming as such: a bare
        // "fetch failed" sends a caller looking at its own arguments.
        if (attempt === maxRetries) {
          const host = safeHost(url);
          throw new Error(
            `${method.toUpperCase()} ${path} could not reach ${host} after ${attempt + 1} attempts: ${text(error)}`,
          );
        }
        continue;
      }

      if (response.ok) return (await readJson(response)) as T;

      const parsed = await readErrorBody(response);
      if (RETRYABLE.has(response.status) && attempt < maxRetries) {
        lastRetryAfter = retryAfterMs(response);
        continue;
      }
      const described = options.describeError?.(response.status, parsed.body);
      throw new HttpError(
        `${method.toUpperCase()} ${path} → ${response.status} ${parsed.code}: ${described ?? parsed.message}`,
        response.status,
        parsed.code,
        parsed.body,
      );
    }

    /* c8 ignore next */
    throw new Error(`${method.toUpperCase()} ${path} exhausted its retries`);
  };

  const collect = async <T>(method: "GET" | "POST", path: string, spec: CollectSpec<T>): Promise<T[]> => {
    const out: T[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      const carrier = cursor
        ? (spec.withCursor?.(cursor) ?? (method === "GET" ? { query: { cursor } } : { body: { cursor } }))
        : {};
      const query = { ...(spec.query ?? {}), ...(carrier.query ?? {}) };
      const body =
        method === "POST" ? { ...(spec.body ?? {}), ...(carrier.body ?? {}) } : undefined;

      const response = await request<unknown>(method, path, body, query);
      out.push(...(spec.items(response) ?? []));

      if (spec.limit && out.length >= spec.limit) return out.slice(0, spec.limit);
      const next = spec.next(response);
      if (!next) return out;
      cursor = next;
    }

    throw new Error(
      `${path} has more pages than the ${maxPages}-page cap. Narrow it with a filter, pass a limit, or raise ` +
        `maxPages — returning the first ${out.length} silently would look like the whole answer.`,
    );
  };

  return { request, collect };
}

function backoff(attempt: number, retryAfter: number | undefined): number {
  if (typeof retryAfter === "number" && retryAfter > 0) return Math.min(retryAfter, 60_000);
  return Math.min(2 ** (attempt - 1) * 500, 8_000);
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers?.get?.("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (body.trim() === "") return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${response.status} response was not JSON: ${body.slice(0, 200)}`);
  }
}

async function readErrorBody(response: Response): Promise<{ code: string; message: string; body: unknown }> {
  let body: unknown = undefined;
  try {
    body = await readJson(response);
  } catch {
    /* a non-JSON error body is still an error; the status carries it */
  }
  const record = (body ?? {}) as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : `http_${response.status}`,
    message: typeof record.message === "string" ? record.message : response.statusText || "request failed",
    body,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the server";
  }
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

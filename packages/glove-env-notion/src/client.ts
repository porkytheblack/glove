/**
 * A small Notion API client, pinned to version `2025-09-03`.
 *
 * That version is the one where a database stopped being a table. A database
 * is now a *container* of one or more **data sources**, each with its own
 * schema, and the endpoints split to match: `/databases` manages the
 * container, `/data_sources` manages the schema and answers queries. Pages
 * parent to a `data_source_id`. Anything written against the older shape
 * breaks the day someone adds a second data source to a database — not on
 * upgrade, which is what makes it worth pinning rather than tracking.
 *
 * Three things this does beyond `fetch`:
 *
 * - **Pagination is exhausted, not exposed.** `has_more` / `next_cursor` is a
 *   loop every caller would write identically and some would forget, and the
 *   symptom of forgetting is a correct-looking answer computed from the first
 *   hundred rows.
 * - **429 is honoured.** Notion returns `Retry-After` in seconds and means
 *   it. Retries also cover the transient 5xx family and network failures,
 *   with a cap, and never cover a 4xx that will fail identically next time.
 * - **Errors carry Notion's own message.** `object_not_found` almost always
 *   means the integration was never given access to the page rather than that
 *   the page is missing, so the error says both.
 */

/** The subset of `fetch` this client uses. Injected in tests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface NotionClientOptions {
  /**
   * An integration token or an OAuth access token. A function is called per
   * request, so a refreshing token works without recreating the client.
   */
  token: string | (() => string | Promise<string>);
  /** Default `https://api.notion.com/v1`. */
  baseUrl?: string;
  /** Default `2025-09-03` — the version this client's shapes match. */
  notionVersion?: string;
  fetch?: FetchLike;
  /** Retries for 429 and transient failures. Default 3. */
  maxRetries?: number;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /**
   * Most pages of results any one call will walk. Default 50 — 5000 items at
   * Notion's maximum page size. A cap rather than a limit: exceeding it
   * throws, because a silently truncated result set is the failure that reads
   * as a correct answer.
   */
  maxPages?: number;
  /** Injected in tests so retry backoff costs no wall-clock. */
  sleep?: (ms: number) => Promise<void>;
}

/** A Notion API failure, with its code and status kept separate from the message. */
export class NotionApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(message: string, status: number, code: string, requestId?: string) {
    super(message);
    this.name = "NotionApiError";
    this.status = status;
    this.code = code;
    if (requestId) this.requestId = requestId;
  }
}

const DEFAULT_BASE = "https://api.notion.com/v1";
const DEFAULT_VERSION = "2025-09-03";
const PAGE_SIZE = 100;
const RETRYABLE_STATUS = new Set([409, 429, 500, 502, 503, 504]);

export class NotionClient {
  private readonly baseUrl: string;
  private readonly version: string;
  private readonly doFetch: FetchLike;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  readonly maxPages: number;

  constructor(private readonly options: NotionClientOptions) {
    if (!options?.token) {
      throw new Error(
        "notion() needs a token — an internal integration secret, or an OAuth access token for the workspace.",
      );
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.version = options.notionVersion ?? DEFAULT_VERSION;
    const injected = options.fetch;
    const ambient = globalThis.fetch;
    if (!injected && typeof ambient !== "function") {
      throw new Error("no fetch available — pass one to notion({ fetch }) on a runtime without a global fetch");
    }
    this.doFetch = injected ?? ((url, init) => ambient(url, init));
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
    this.timeoutMs = Math.max(1000, options.timeoutMs ?? 30_000);
    this.maxPages = Math.max(1, options.maxPages ?? 50);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async authorization(): Promise<string> {
    const token = typeof this.options.token === "function" ? await this.options.token() : this.options.token;
    if (typeof token !== "string" || token.trim() === "") throw new Error("the Notion token resolved to an empty value");
    return `Bearer ${token.trim()}`;
  }

  /**
   * One API call. `path` is relative to the version root — `/pages/<id>`.
   *
   * Exposed rather than kept private because the block type enum and the
   * endpoint surface both grow faster than any wrapper: when the adapter has
   * no binding for what you need, this is the way through.
   */
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/${String(path).replace(/^\/+/, "")}`;
    const headers: Record<string, string> = {
      Authorization: await this.authorization(),
      "Notion-Version": this.version,
      Accept: "application/json",
    };
    const init: RequestInit = { method: method.toUpperCase(), headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(this.backoff(attempt, lastError));

      let response: Response;
      try {
        response = await this.doFetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (e) {
        // Network failure or timeout: retryable, and worth naming as such
        // because "fetch failed" alone sends a model looking at its arguments.
        lastError = e;
        if (attempt === this.maxRetries) {
          throw new Error(
            `${method.toUpperCase()} ${path} could not reach api.notion.com after ${attempt + 1} attempts: ` +
              `${e instanceof Error ? e.message : String(e)}`,
          );
        }
        continue;
      }

      if (response.ok) return (await readJson(response)) as T;

      const detail = await readError(response);
      if (RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries) {
        lastError = { retryAfter: retryAfterMs(response) };
        continue;
      }
      throw new NotionApiError(explain(detail, method, path), response.status, detail.code, detail.requestId);
    }

    /* c8 ignore next */
    throw new Error(`${method.toUpperCase()} ${path} exhausted its retries`);
  }

  /** Milliseconds to wait before `attempt`. Honours `Retry-After` when the server sent one. */
  private backoff(attempt: number, last: unknown): number {
    const declared = (last as { retryAfter?: number } | undefined)?.retryAfter;
    if (typeof declared === "number" && declared > 0) return Math.min(declared, 60_000);
    return Math.min(2 ** (attempt - 1) * 500, 8_000);
  }

  /**
   * Walk every page of a list endpoint.
   *
   * `limit` stops early at a whole number of results; without one the cap is
   * `maxPages`, and hitting it throws rather than returning a prefix.
   */
  async collect<T = unknown>(
    method: "GET" | "POST",
    path: string,
    body: Record<string, unknown> | undefined,
    limit?: number,
  ): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < this.maxPages; page++) {
      const size = limit ? Math.min(PAGE_SIZE, limit - out.length) : PAGE_SIZE;
      let response: { results?: T[]; has_more?: boolean; next_cursor?: string | null };

      if (method === "GET") {
        const query = new URLSearchParams({ page_size: String(size) });
        if (cursor) query.set("start_cursor", cursor);
        response = await this.request("GET", `${path}${path.includes("?") ? "&" : "?"}${query}`);
      } else {
        response = await this.request("POST", path, {
          ...(body ?? {}),
          page_size: size,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
      }

      out.push(...(Array.isArray(response.results) ? response.results : []));
      if (limit && out.length >= limit) return out.slice(0, limit);
      if (!response.has_more || !response.next_cursor) return out;
      cursor = response.next_cursor;
    }

    throw new Error(
      `${path} has more than ${this.maxPages * PAGE_SIZE} results. Narrow it with a filter, pass a limit, ` +
        `or raise maxPages — returning the first ${out.length} silently would look like the whole answer.`,
    );
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`api.notion.com returned ${response.status} with a body that is not JSON: ${text.slice(0, 200)}`);
  }
}

interface ErrorDetail {
  code: string;
  message: string;
  status: number;
  requestId?: string;
}

async function readError(response: Response): Promise<ErrorDetail> {
  let parsed: Record<string, unknown> = {};
  try {
    const body = await readJson(response);
    if (body && typeof body === "object") parsed = body as Record<string, unknown>;
  } catch {
    /* a non-JSON error body is still an error; the status carries it */
  }
  return {
    code: typeof parsed.code === "string" ? parsed.code : `http_${response.status}`,
    message: typeof parsed.message === "string" ? parsed.message : response.statusText || "request failed",
    status: response.status,
    ...(typeof parsed.request_id === "string" ? { requestId: parsed.request_id } : {}),
  };
}

/**
 * Notion's message, plus the thing its message never says.
 *
 * An integration sees only what has been explicitly shared with it, and the
 * API reports an unshared page as missing. Left unexplained that reads as a
 * bad id, and the next thing a model does is re-derive the id it already had.
 */
function explain(detail: ErrorDetail, method: string, path: string): string {
  const head = `${method.toUpperCase()} ${path} → ${detail.status} ${detail.code}: ${detail.message}`;
  switch (detail.code) {
    case "object_not_found":
      return `${head}\nAn integration sees only what has been shared with it. If the id is right, open the page in Notion → ••• → Connections, and add this integration.`;
    case "unauthorized":
      return `${head}\nThe token was rejected. Check it has not been revoked, and that it belongs to the workspace holding this object.`;
    case "restricted_resource":
      return `${head}\nThe token is valid but lacks the capability this call needs (read content, update content, insert content) — set it on the integration.`;
    case "validation_error":
      return `${head}\nThis is usually a property whose type does not match the value sent, or a parent given as a database where API version 2025-09-03 wants a data source.`;
    default:
      return head;
  }
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers?.get?.("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

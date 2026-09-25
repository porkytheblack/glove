export type ClassifierErrorCode =
  /** The request was malformed before it left the process (or the provider returned 4xx validation). */
  | "invalid_request"
  /** Missing or rejected credentials (HTTP 401 / 403). */
  | "auth"
  /** Rate limited or overloaded after retries ran out (HTTP 429 / 529). */
  | "rate_limited"
  /** Any other non-2xx response after retries ran out. */
  | "provider"
  /** The provider answered, but not with an answer for every question. */
  | "bad_response"
  /** Network failure or per-attempt timeout after retries ran out. */
  | "connection";

/** Every failure this package raises. Aborts surface as glove-core's `AbortError` instead. */
export class ClassifierError extends Error {
  readonly code: ClassifierErrorCode;
  /** HTTP status, when the failure came from a response. */
  readonly status?: number;
  /** Parsed response body (or raw text), when there was one. */
  readonly body?: unknown;

  constructor(
    code: ClassifierErrorCode,
    message: string,
    extra: { status?: number; body?: unknown; cause?: unknown } = {},
  ) {
    super(message, extra.cause !== undefined ? { cause: extra.cause } : undefined);
    this.name = "ClassifierError";
    this.code = code;
    if (extra.status !== undefined) this.status = extra.status;
    if (extra.body !== undefined) this.body = extra.body;
  }
}

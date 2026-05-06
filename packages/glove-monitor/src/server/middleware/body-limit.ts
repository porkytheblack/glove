import type { MiddlewareHandler } from "hono"

export interface BodyLimitOptions {
  /** Maximum allowed Content-Length in bytes. */
  maxBytes: number
}

/**
 * Reject requests whose declared Content-Length exceeds the limit before the
 * JSON parser allocates anything. Streamed bodies without a Content-Length
 * are passed through; defending against those requires a chunked-stream
 * counter and is out of scope for this lightweight gate.
 */
export function bodyLimit(opts: BodyLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const lenHeader = c.req.header("content-length")
    if (!lenHeader) return next()
    const len = Number(lenHeader)
    if (Number.isFinite(len) && len > opts.maxBytes) {
      return c.json(
        { error: "payload_too_large", max_bytes: opts.maxBytes },
        413,
      )
    }
    await next()
  }
}

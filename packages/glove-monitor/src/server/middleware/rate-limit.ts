import type { MiddlewareHandler } from "hono"

/**
 * In-memory token-bucket rate limiter, scoped to a single process.
 *
 * Multi-process deployments should sit behind a Redis or upstream-edge rate
 * limiter — this protects a single instance from accidental loops and
 * unauthenticated abuse, not from coordinated attacks.
 */

export interface RateLimitOptions {
  windowMs: number
  max: number
  /** Resolve a stable key per caller. Default: client IP from x-forwarded-for / remote addr. */
  keyFn?: (req: Request) => string
  /** Override the rejection message (otherwise 429 with retry-after seconds). */
  message?: string
}

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

function defaultKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0]!.trim()
  // Hono's request shape doesn't expose remote addr directly; fall back to
  // a fixed bucket so the limiter still has a worst-case ceiling.
  return "unknown"
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const keyFn = opts.keyFn ?? defaultKey
  return async (c, next) => {
    const key = `${c.req.path}::${keyFn(c.req.raw)}`
    const now = Date.now()
    let b = buckets.get(key)
    if (!b || b.resetAt < now) {
      b = { count: 0, resetAt: now + opts.windowMs }
      buckets.set(key, b)
    }
    b.count++
    if (b.count > opts.max) {
      const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000))
      c.header("retry-after", String(retryAfter))
      return c.json(
        { error: "rate_limited", message: opts.message ?? "too many requests", retry_after: retryAfter },
        429,
      )
    }
    await next()
  }
}

/**
 * Periodically prune expired buckets so the map doesn't grow unbounded.
 * Called once at module load time; safe across hot reload because
 * `unref()` lets Node exit if this is the only timer left.
 */
function startSweeper(): void {
  const t = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k)
  }, 60_000)
  if (typeof t.unref === "function") t.unref()
}
startSweeper()

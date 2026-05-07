import type { MiddlewareHandler } from "hono"

/**
 * Lightweight CSRF protection for cookie-authenticated mutating routes.
 *
 * Strategy: for any non-safe method (POST/PUT/PATCH/DELETE) that arrives
 * with a session cookie (i.e. `auth.type === "session"`), require the
 * `Origin` (or `Referer`) header to match the request's `Host`. Bearer-auth
 * requests (api-key, access-token) are not CSRF-vulnerable since browsers
 * don't auto-attach Authorization headers cross-site, so they're exempt.
 *
 * Allowed origins can be extended via `GLOVE_MONITOR_TRUSTED_ORIGINS`
 * (comma-separated list of origins like "https://dashboard.example.com").
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function trustedOrigins(): Set<string> {
  const env = process.env.GLOVE_MONITOR_TRUSTED_ORIGINS
  if (!env) return new Set()
  return new Set(env.split(",").map((s) => s.trim()).filter(Boolean))
}

export function csrfGuard(): MiddlewareHandler {
  const allow = trustedOrigins()
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next()

    const auth = c.get("auth")
    // Only cookie-authed (session) requests are vulnerable. Bearer-token
    // requests do not auto-ride from a victim's browser.
    if (!auth || auth.type !== "session") return next()
    // Anonymous-admin dev mode is unauthenticated by definition; CSRF is
    // moot because there are no credentials to forge.
    if (auth.username === "anonymous") return next()

    const origin = c.req.header("origin")
    const referer = c.req.header("referer")
    const host = c.req.header("host")
    const xfp = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase()
    const proto = xfp ?? new URL(c.req.url).protocol.replace(":", "")
    const expectedOrigin = host ? `${proto}://${host}` : null

    const candidate = origin ?? (referer ? new URL(referer).origin : null)
    if (!candidate) return c.json({ error: "csrf_missing_origin" }, 403)
    if (candidate === expectedOrigin) return next()
    if (allow.has(candidate)) return next()
    return c.json({ error: "csrf_origin_mismatch", origin: candidate }, 403)
  }
}

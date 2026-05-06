import { Hono } from "hono"
import { z } from "zod"
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  verifyCredentials,
  type SessionConfig,
} from "../../auth/sessions.js"

export interface AuthRouterOptions {
  session?: SessionConfig
}

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

/**
 * Build a Set-Cookie value with appropriate flags. `Secure` is set whenever
 * the request looks HTTPS-terminated (either directly or via a forwarding
 * proxy). In production deployments behind a non-HTTPS reverse proxy, set
 * `GLOVE_MONITOR_ALWAYS_SECURE_COOKIE=1` to force `Secure` regardless.
 */
function buildSetCookie(req: Request, value: string, maxAgeSec: number): string {
  const xfp = req.headers.get("x-forwarded-proto") ?? ""
  const url = new URL(req.url)
  const isHttps = url.protocol === "https:" || xfp.split(",")[0]?.trim().toLowerCase() === "https"
  const force = process.env.GLOVE_MONITOR_ALWAYS_SECURE_COOKIE === "1"
  const secure = isHttps || force
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ]
  if (secure) parts.push("Secure")
  return parts.join("; ")
}

export function authRoutes(opts: AuthRouterOptions): Hono {
  const app = new Hono()

  app.post("/login", async (c) => {
    if (!opts.session) {
      return c.json({ error: "auth_disabled" }, 400)
    }
    const body = await c.req.json().catch(() => ({}))
    const parsed = LoginSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400)

    if (!verifyCredentials(opts.session, parsed.data.username, parsed.data.password)) {
      // Slight uniform delay to slow brute force.
      await new Promise((r) => setTimeout(r, 250))
      return c.json({ error: "invalid_credentials" }, 401)
    }

    const { token, expiresAt } = createSessionToken(opts.session)
    const maxAge = Math.floor((expiresAt - Date.now()) / 1000)
    c.header("set-cookie", buildSetCookie(c.req.raw, token, maxAge))
    return c.json({ ok: true, expiresAt })
  })

  app.post("/logout", (c) => {
    c.header("set-cookie", buildSetCookie(c.req.raw, "", 0))
    return c.json({ ok: true })
  })

  app.get("/me", (c) => {
    const auth = c.get("auth")
    if (!auth || auth.type !== "session") return c.json({ error: "unauthorized" }, 401)
    return c.json({ username: auth.username })
  })

  return app
}

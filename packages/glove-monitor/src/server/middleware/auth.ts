import type { MiddlewareHandler } from "hono"
import type { MonitorStorageAdapter } from "../../adapters/types.js"
import { SESSION_COOKIE_NAME, verifySessionToken, type SessionConfig } from "../auth/sessions.js"
import { payloadIdentity, sha256Hex, verifyAccessToken } from "../auth/tokens.js"

export type AuthType = "session" | "api-key" | "access-token" | "none"

export interface AuthContext {
  type: AuthType
  projectId?: string
  clientId?: string         // for access-token auth
  apiKeyId?: string         // for api-key auth
  scopes: string[]
  username?: string         // for session auth
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext
  }
}

export interface AuthResolverOptions {
  adapter: MonitorStorageAdapter
  session?: SessionConfig
  /** Server-wide secret used to verify access tokens. */
  accessTokenSecret: string
  /**
   * Allow unauthenticated requests to be treated as fully-privileged admin.
   * Required default-off; intended ONLY for local development. Even when
   * passed, this middleware additionally refuses to enable in production
   * (i.e. when `process.env.NODE_ENV === "production"`).
   */
  allowAnonymousAdmin?: boolean
}

export function authResolver(opts: AuthResolverOptions): MiddlewareHandler {
  return async (c, next) => {
    const ctx: AuthContext = { type: "none", scopes: [] }

    // 1. Bearer header — could be API key OR access token
    const authHeader = c.req.header("authorization") ?? c.req.header("Authorization")
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length).trim()

      // sk_… is an API key
      if (token.startsWith("sk_")) {
        const hash = sha256Hex(token)
        const apiKey = await opts.adapter.findApiKeyByHash(hash)
        if (apiKey && !apiKey.revoked && (!apiKey.expiresAt || new Date(apiKey.expiresAt) > new Date())) {
          ctx.type = "api-key"
          ctx.apiKeyId = apiKey.id
          ctx.projectId = apiKey.projectId
          ctx.scopes = apiKey.scopes
          // best-effort touch
          Promise.resolve()
            .then(() => opts.adapter.touchApiKey(apiKey.id, new Date().toISOString()))
            .catch(() => {})
        }
      } else {
        // Otherwise treat as access token
        const payload = verifyAccessToken(token, opts.accessTokenSecret)
        if (payload) {
          const id = payloadIdentity(payload)
          const client = await opts.adapter.getClient(id.client_id)
          // Defence-in-depth: token's `aud` (project_id) must match the client's
          // current project. Prevents a token forged with a stale aud from
          // operating against a different project.
          if (client && !client.revoked && client.projectId === id.project_id) {
            ctx.type = "access-token"
            ctx.clientId = client.id
            ctx.projectId = client.projectId
            ctx.scopes = ["ingest"]
            Promise.resolve()
              .then(() => opts.adapter.touchClient(client.id, new Date().toISOString()))
              .catch(() => {})
          }
        }
      }
    }

    // 2. Session cookie (dashboard)
    if (ctx.type === "none" && opts.session) {
      const cookie = c.req.header("cookie") ?? ""
      const sessionToken = parseCookie(cookie, SESSION_COOKIE_NAME)
      if (sessionToken) {
        const verified = verifySessionToken(opts.session, sessionToken)
        if (verified) {
          ctx.type = "session"
          ctx.username = verified.username
          ctx.scopes = ["read", "admin"]
          // Sessions are dashboard-scoped (no project_id). The dashboard's
          // project picker sets a `x-glove-project` header for project context.
          const headerProject = c.req.header("x-glove-project")
          if (headerProject) ctx.projectId = headerProject
        }
      }
    }

    // 3. Dev-mode anonymous admin fallback. Default OFF; even when explicitly
    // enabled it refuses to activate in production. Without this gate, simply
    // forgetting to configure auth would silently expose every admin route.
    if (ctx.type === "none" && !opts.session && opts.allowAnonymousAdmin && process.env.NODE_ENV !== "production") {
      ctx.type = "session"
      ctx.username = "anonymous"
      ctx.scopes = ["read", "admin"]
      const headerProject = c.req.header("x-glove-project")
      if (headerProject) ctx.projectId = headerProject
    }

    c.set("auth", ctx)
    await next()
  }
}

export function requireScope(scope: string): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.get("auth")
    if (!auth || auth.type === "none") return c.json({ error: "unauthorized" }, 401)
    if (!auth.scopes.includes(scope) && !auth.scopes.includes("admin")) {
      return c.json({ error: "forbidden", scope }, 403)
    }
    await next()
  }
}

export function requireSession(): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.get("auth")
    if (!auth || auth.type !== "session") return c.json({ error: "unauthorized" }, 401)
    await next()
  }
}

export function requireIngest(): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.get("auth")
    if (!auth || auth.type !== "access-token") return c.json({ error: "unauthorized" }, 401)
    await next()
  }
}

function parseCookie(header: string, name: string): string | null {
  const parts = header.split(";")
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=")
    if (k === name) return decodeURIComponent(rest.join("="))
  }
  return null
}

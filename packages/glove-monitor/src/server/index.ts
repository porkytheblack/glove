import { Hono } from "hono"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import crypto from "node:crypto"
import type { MonitorConfig } from "../config/schema.js"
import { resolveConfig } from "../config/schema.js"
import type { MonitorStorageAdapter } from "../adapters/types.js"
import { MemoryAdapter } from "../adapters/memory.js"
import { authResolver } from "./middleware/auth.js"
import { csrfGuard } from "./middleware/csrf.js"
import { rateLimit } from "./middleware/rate-limit.js"
import { bodyLimit } from "./middleware/body-limit.js"
import { buildSessionConfig, type SessionConfig } from "./auth/sessions.js"
import { ingestRoutes } from "./routes/v1/ingest.js"
import { oauthRoutes } from "./routes/v1/oauth.js"
import { authRoutes } from "./routes/v1/auth.js"
import { projectsRoutes } from "./routes/v1/projects.js"
import { conversationsRoutes } from "./routes/v1/conversations.js"
import { aggregateRoutes } from "./routes/v1/aggregates.js"
import { eventsRoutes } from "./routes/v1/events.js"
import { healthRoutes } from "./routes/v1/health.js"
import { overviewRoutes } from "./routes/v1/overview.js"
import { SSEHub } from "./sse.js"
import { WebSocketHub } from "./ws.js"
import type { IngestContext } from "./ingest-pipeline.js"

export interface CreateServerOptions {
  config: MonitorConfig
}

export interface CreatedServer {
  app: Hono
  config: MonitorConfig
  adapter: MonitorStorageAdapter
  sseHub: SSEHub
  wsHub: WebSocketHub
  ingestContext: IngestContext
  accessTokenSecret: string
}

/**
 * Build the Hono app with all routes mounted. Caller is responsible for
 * adapting it to a runtime (`@hono/node-server`, Next.js route, etc.) and
 * for upgrading WebSocket connections on `/api/events`.
 */
export async function createServer(input: Parameters<typeof resolveConfig>[0]): Promise<CreatedServer> {
  const config = resolveConfig(input)
  const dataDir = resolve(process.cwd(), config.dataDir)
  mkdirSync(dataDir, { recursive: true })

  const adapter = config.adapter ?? new MemoryAdapter()
  await adapter.init()

  // Self-contained access-token secret. Persisted by callers who want
  // tokens to survive restarts; ephemeral for memory deployments.
  const accessTokenSecret = process.env.GLOVE_MONITOR_ACCESS_TOKEN_SECRET
    ?? crypto.randomBytes(32).toString("hex")
  const accessTokenTtlMs = 60 * 60 * 1000  // 1h

  const sseHub = new SSEHub()
  const wsHub = new WebSocketHub()
  const ingestContext: IngestContext = {
    adapter,
    sseHub,
    wsHub,
    pricingOverrides: config.pricing?.rates,
  }

  const session: SessionConfig | undefined = config.auth
    ? buildSessionConfig({
        username: config.auth.username,
        password: config.auth.password,
        sessionSecret: config.auth.sessionSecret,
        ttlMs: config.auth.sessionTtlMs ?? 24 * 60 * 60 * 1000,
      })
    : undefined

  const app = new Hono()

  app.use("*", authResolver({
    adapter,
    session,
    accessTokenSecret,
    allowAnonymousAdmin: config.allowAnonymousAdmin,
  }))

  // CSRF: gate cookie-authed mutating requests; Bearer-auth paths are exempt.
  app.use("/api/v1/*", csrfGuard())

  // Per-route rate limits. Numbers are deliberately conservative — multi-process
  // deployments should add an upstream rate limiter as well.
  app.use("/oauth/register", rateLimit({ windowMs: 60_000, max: 10 }))
  app.use("/oauth/token",    rateLimit({ windowMs: 60_000, max: 60 }))
  app.use("/api/v1/auth/login", rateLimit({ windowMs: 60_000, max: 5 }))
  app.use("/api/v1/ingest", rateLimit({ windowMs: 60_000, max: 600 }))

  // Body-size limits in front of the JSON parser. 1 MB on ingest is far above
  // the realistic batch size (50 events × few KB each) and below what would
  // OOM the parser on a malicious oversized payload. Other JSON-accepting
  // routes (auth/login, project/key/token CRUD) are far smaller, so 64 KB.
  app.use("/api/v1/ingest", bodyLimit({ maxBytes: 1 * 1024 * 1024 }))
  app.use("/api/v1/auth/*", bodyLimit({ maxBytes: 16 * 1024 }))
  app.use("/api/v1/projects", bodyLimit({ maxBytes: 16 * 1024 }))
  app.use("/api/v1/projects/*", bodyLimit({ maxBytes: 16 * 1024 }))
  app.use("/oauth/*", bodyLimit({ maxBytes: 16 * 1024 }))

  app.route("/oauth", oauthRoutes({ adapter, accessTokenSecret, accessTokenTtlMs }))

  app.route("/api/v1/health", healthRoutes())
  app.route("/api/v1/auth", authRoutes({ session }))
  app.route("/api/v1/ingest", ingestRoutes(ingestContext))
  app.route("/api/v1/projects", projectsRoutes(adapter))
  app.route("/api/v1/conversations", conversationsRoutes(adapter))
  app.route("/api/v1", aggregateRoutes(adapter))   // /tools, /apps, /clients, /models
  app.route("/api/v1/overview", overviewRoutes(adapter))
  app.route("/api/v1/events", eventsRoutes(sseHub))

  return { app, config, adapter, sseHub, wsHub, ingestContext, accessTokenSecret }
}

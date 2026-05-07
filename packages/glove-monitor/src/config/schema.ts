import type { MonitorStorageAdapter } from "../adapters/types.js"
import type { ModelRate } from "../pricing/rates.js"

export interface MonitorAuthConfig {
  username: string
  password: string
  /**
   * HMAC secret used to sign session cookies. If omitted, a random secret
   * is generated per process — sessions then do not survive restarts. For
   * production multi-process deployments, supply a stable secret via
   * `GLOVE_MONITOR_SESSION_SECRET`.
   */
  sessionSecret?: string
  sessionTtlMs?: number
}

export interface MonitorPricingConfig {
  rates?: Record<string, ModelRate>
}

export interface MonitorConfig {
  /** Hono API server port (the ingest + read API). */
  port: number
  /** Next.js dashboard port. The dashboard rewrites `/api/*` to `apiUrl`. */
  dashboardPort: number
  host: string
  dataDir: string
  /**
   * Base URL the Next.js dashboard should rewrite `/api/*` to. Defaults to
   * `http://${host}:${port}` (i.e. the in-process Hono server). Override when
   * the dashboard runs separately and points at a remote API.
   */
  apiUrl?: string
  adapter?: MonitorStorageAdapter
  auth?: MonitorAuthConfig
  pricing?: MonitorPricingConfig
  /**
   * Permit unauthenticated callers full admin scope. Default false. Even
   * when true, this is refused in production (`NODE_ENV === "production"`).
   * Intended only for local development.
   */
  allowAnonymousAdmin: boolean
  open: boolean
  logLevel: "debug" | "info" | "warn" | "error"
}

export type MonitorUserConfig = Partial<MonitorConfig>

const DEFAULTS: MonitorConfig = {
  port: 4500,
  dashboardPort: 3000,
  host: "localhost",
  dataDir: ".glove-monitor",
  allowAnonymousAdmin: false,
  open: true,
  logLevel: "info",
}

export function defineConfig(input: MonitorUserConfig): MonitorUserConfig {
  return input
}

export function resolveConfig(input: MonitorUserConfig): MonitorConfig {
  const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined
  const envDashboardPort = process.env.GLOVE_MONITOR_DASHBOARD_PORT
    ? parseInt(process.env.GLOVE_MONITOR_DASHBOARD_PORT, 10)
    : undefined
  const envHost = process.env.HOST
  const envApiUrl = process.env.GLOVE_MONITOR_API_URL
  const envAuthUser = process.env.GLOVE_MONITOR_AUTH_USERNAME
  const envAuthPass = process.env.GLOVE_MONITOR_AUTH_PASSWORD

  let auth = input.auth
  const envSessionSecret = process.env.GLOVE_MONITOR_SESSION_SECRET
  if (auth) {
    auth = {
      ...auth,
      username: envAuthUser ?? auth.username,
      password: envAuthPass ?? auth.password,
      sessionSecret: envSessionSecret ?? auth.sessionSecret,
    }
  } else if (envAuthUser && envAuthPass) {
    auth = { username: envAuthUser, password: envAuthPass, sessionSecret: envSessionSecret }
  }

  // Anonymous-admin can be opted into via env, but is hard-refused in production.
  const envAnon = process.env.GLOVE_MONITOR_ALLOW_ANONYMOUS_ADMIN === "1"
    || process.env.GLOVE_MONITOR_ALLOW_ANONYMOUS_ADMIN === "true"
  const allowAnonymousAdmin = (input.allowAnonymousAdmin ?? envAnon) && process.env.NODE_ENV !== "production"

  const port = input.port ?? envPort ?? DEFAULTS.port
  const host = input.host ?? envHost ?? DEFAULTS.host
  return {
    port,
    dashboardPort: input.dashboardPort ?? envDashboardPort ?? DEFAULTS.dashboardPort,
    host,
    dataDir: input.dataDir ?? DEFAULTS.dataDir,
    apiUrl: input.apiUrl ?? envApiUrl,  // fall back to derived `http://host:port` at consumer-side if undefined
    adapter: input.adapter,
    auth,
    pricing: input.pricing,
    allowAnonymousAdmin,
    open: input.open ?? DEFAULTS.open,
    logLevel: input.logLevel ?? DEFAULTS.logLevel,
  }
}

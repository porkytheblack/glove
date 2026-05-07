"use client"

// Fetch wrapper for the glove-monitor HTTP API. The dashboard runs on :3000
// and the Hono server on :4500; `next.config.mjs` proxies `/api/*` so the
// browser sees a same-origin URL and `credentials: "include"` carries the
// session cookie.

const API_BASE = ""

export interface ApiResponse<T> {
  data: T
  next_cursor?: string | null
}

interface FetchOpts extends RequestInit {
  query?: Record<string, string | number | undefined | null>
}

async function fetchApi<T>(path: string, opts: FetchOpts = {}): Promise<ApiResponse<T>> {
  const url = new URL(`${API_BASE}/api${path}`, typeof window !== "undefined" ? window.location.href : "http://localhost:3000")
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), {
    ...opts,
    credentials: "include",
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const body = await res.json() as { error?: string }
      if (body.error) msg = body.error
    } catch { /* not JSON */ }
    throw new Error(msg)
  }
  return res.json() as Promise<ApiResponse<T>>
}

// ─── Auth ────────────────────────────────────────────────────────────

export async function checkAuth(): Promise<{ authenticated: boolean; authRequired: boolean; username?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/me`, { credentials: "include" })
  if (res.status === 401 || res.status === 403) return { authenticated: false, authRequired: true }
  if (res.status === 404) return { authenticated: true, authRequired: false }
  if (!res.ok) throw new Error(`auth check ${res.status}`)
  const body = await res.json() as { data?: { username?: string } }
  return { authenticated: true, authRequired: true, username: body.data?.username }
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    let msg = "login failed"
    try { const b = await res.json() as { error?: string }; if (b.error) msg = b.error } catch { /* */ }
    throw new Error(msg)
  }
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/api/v1/auth/logout`, { method: "POST", credentials: "include" })
}

// ─── Domain types (mirror server response shapes) ───────────────────

export interface OverviewMetrics {
  conversationsInWindow: number
  activeNow: number
  tokensIn: number
  tokensOut: number
  costMicros: number
  toolCalls: number
  toolErrors: number
  since: string
  until: string
}

export interface ConversationRow {
  id: string
  projectId: string
  appName: string
  conversationId: string
  subject: string
  userId: string | null
  clientId: string
  status: "active" | "completed" | "errored"
  startedAt: string
  lastEventAt: string
  messageCount: number
  toolCallCount: number
  errorCount: number
  totalTokensIn: number
  totalTokensOut: number
  totalCostMicros: number
  modelsUsed: string[]
}

export interface EventRow {
  id: string
  conversationPk: string
  projectId: string
  appName: string
  conversationId: string
  subject: string
  userId: string | null
  clientId: string
  type: string
  payload: Record<string, unknown>
  model: string | null
  tokensIn: number | null
  tokensOut: number | null
  costMicros: number | null
  latencyMs: number | null
  occurredAt: string
  ingestedAt: string
}

export interface ToolStat {
  toolName: string
  count: number
  errorCount: number
  avgLatencyMs: number | null
}

export interface AppRow {
  projectId: string
  name: string
  firstSeen: string
  lastSeen: string
}

export interface ClientRow {
  id: string
  projectId: string
  name: string | null
  softwareId: string | null
  createdAt: string
  lastSeen: string | null
  revoked: boolean
}

export interface ModelStat {
  model: string
  conversations: number
  tokensIn: number
  tokensOut: number
  costMicros: number
}

export interface ProjectRow {
  id: string
  slug: string
  name: string
  createdAt: string
}

export interface RegistrationTokenRow {
  id: string
  projectId: string
  name: string
  tokenPrefix: string
  scopes: string[]
  createdAt: string
  expiresAt: string | null
  revoked: boolean
}

export interface ApiKeyRow {
  id: string
  projectId: string
  name: string
  keyPrefix: string
  scopes: string[]
  createdAt: string
  lastUsed: string | null
  expiresAt: string | null
  revoked: boolean
}

export interface PricingRow {
  model: string
  inputPer1kMicros: number
  outputPer1kMicros: number
  updatedAt: string
}

export interface TokenSeriesPoint { bucket: string; tokensIn: number; tokensOut: number }
export interface CostSeriesPoint  { bucket: string; costMicros: number }

// ─── API methods ────────────────────────────────────────────────────

export function useApi() {
  return {
    getOverview: (opts?: { since?: string; until?: string }) =>
      fetchApi<OverviewMetrics>("/v1/overview", { query: opts }),
    listTokenSeries: (opts: { since?: string; until?: string; bucket?: "hour" | "day" }) =>
      fetchApi<TokenSeriesPoint[]>("/v1/overview/timeseries/tokens", { query: opts }),
    listCostSeries: (opts: { since?: string; until?: string; bucket?: "hour" | "day" }) =>
      fetchApi<CostSeriesPoint[]>("/v1/overview/timeseries/cost", { query: opts }),

    listConversations: (opts: { app?: string; subject?: string; status?: string; limit?: number; cursor?: string } = {}) =>
      fetchApi<ConversationRow[]>("/v1/conversations", { query: opts }),
    getConversation: (id: string) =>
      fetchApi<ConversationRow>(`/v1/conversations/${encodeURIComponent(id)}`),
    listEvents: (conversationId: string, limit = 1000) =>
      fetchApi<EventRow[]>(`/v1/conversations/${encodeURIComponent(conversationId)}/events`, { query: { limit } }),

    listTools: () => fetchApi<ToolStat[]>("/v1/tools"),
    listApps: () => fetchApi<AppRow[]>("/v1/apps"),
    listClients: () => fetchApi<ClientRow[]>("/v1/clients"),
    revokeClient: (id: string) =>
      fetchApi<{ ok: boolean }>(`/v1/clients/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listModels: () => fetchApi<ModelStat[]>("/v1/models"),

    listProjects: () => fetchApi<ProjectRow[]>("/v1/projects"),
    createProject: (body: { slug: string; name: string }) =>
      fetchApi<ProjectRow>("/v1/projects", { method: "POST", body: JSON.stringify(body) }),

    listRegistrationTokens: (projectId: string) =>
      fetchApi<RegistrationTokenRow[]>(`/v1/projects/${encodeURIComponent(projectId)}/registration-tokens`),
    createRegistrationToken: (projectId: string, body: { name: string }) =>
      fetchApi<{ token: string; row: RegistrationTokenRow }>(
        `/v1/projects/${encodeURIComponent(projectId)}/registration-tokens`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    revokeRegistrationToken: (projectId: string, id: string) =>
      fetchApi<{ ok: boolean }>(
        `/v1/projects/${encodeURIComponent(projectId)}/registration-tokens/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),

    listApiKeys: (projectId: string) =>
      fetchApi<ApiKeyRow[]>(`/v1/projects/${encodeURIComponent(projectId)}/keys`),
    createApiKey: (projectId: string, body: { name: string; scopes?: string[] }) =>
      fetchApi<{ key: string; row: ApiKeyRow }>(
        `/v1/projects/${encodeURIComponent(projectId)}/keys`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    revokeApiKey: (projectId: string, id: string) =>
      fetchApi<{ ok: boolean }>(
        `/v1/projects/${encodeURIComponent(projectId)}/keys/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),

    listPricing: (projectId: string) =>
      fetchApi<PricingRow[]>(`/v1/projects/${encodeURIComponent(projectId)}/pricing`),
    setPricing: (projectId: string, body: { model: string; inputPer1kMicros: number; outputPer1kMicros: number }) =>
      fetchApi<PricingRow>(
        `/v1/projects/${encodeURIComponent(projectId)}/pricing`,
        { method: "PUT", body: JSON.stringify(body) },
      ),
  }
}

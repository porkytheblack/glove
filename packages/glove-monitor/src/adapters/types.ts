// ─── Domain records ──────────────────────────────────────────────────

export interface Project {
  id: string
  slug: string
  name: string
  createdAt: string
}

export interface RegistrationToken {
  id: string
  projectId: string
  name: string
  tokenHash: string
  tokenPrefix: string
  scopes: string[]
  createdAt: string
  expiresAt: string | null
  revoked: boolean
}

export interface Client {
  id: string
  projectId: string
  name: string | null
  softwareId: string | null
  clientSecretHash: string
  registrationAccessTokenHash: string
  createdAt: string
  lastSeen: string | null
  revoked: boolean
}

export interface ApiKey {
  id: string
  projectId: string
  name: string
  keyHash: string
  keyPrefix: string
  scopes: string[]
  createdAt: string
  lastUsed: string | null
  expiresAt: string | null
  revoked: boolean
}

export interface AppRecord {
  projectId: string
  name: string
  firstSeen: string
  lastSeen: string
}

export interface Conversation {
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

export interface EventRecord {
  id: string
  conversationPk: string
  projectId: string
  appName: string
  conversationId: string
  subject: string
  userId: string | null
  clientId: string
  type: string
  payload: unknown
  model: string | null
  tokensIn: number | null
  tokensOut: number | null
  costMicros: number | null
  latencyMs: number | null
  occurredAt: string
  ingestedAt: string
}

export interface ToolCallRecord {
  id: string
  eventId: string
  conversationPk: string
  projectId: string
  appName: string
  toolName: string
  status: "success" | "error" | "aborted"
  startedAt: string
  endedAt: string | null
  latencyMs: number | null
  errorMessage: string | null
}

export interface PricingRateRow {
  model: string
  inputPer1kMicros: number
  outputPer1kMicros: number
  updatedAt: string
}

export interface ListConversationsResult {
  conversations: Conversation[]
  nextCursor: string | null
}

// ─── Storage interface ───────────────────────────────────────────────

export interface MonitorStorageAdapter {
  // Lifecycle
  init(): Promise<void> | void
  close?(): Promise<void> | void

  /**
   * Run `fn` inside a write transaction. SQL backends use a real transaction
   * with rollback-on-throw; the in-memory backend runs `fn` synchronously
   * (single-threaded, so atomic by construction). Use this to make the
   * multi-write `processEvent` chain atomic.
   */
  withTransaction<T>(fn: () => Promise<T> | T): Promise<T>

  // Projects
  insertProject(p: Project): Promise<void> | void
  getProject(id: string): Promise<Project | null> | Project | null
  getProjectBySlug(slug: string): Promise<Project | null> | Project | null
  listProjects(): Promise<Project[]> | Project[]

  // Registration tokens
  insertRegistrationToken(t: RegistrationToken): Promise<void> | void
  findRegistrationTokenByHash(hash: string): Promise<RegistrationToken | null> | RegistrationToken | null
  listRegistrationTokens(projectId: string): Promise<RegistrationToken[]> | RegistrationToken[]
  revokeRegistrationToken(id: string): Promise<boolean> | boolean

  // Clients (DCR'd)
  insertClient(c: Client): Promise<void> | void
  getClient(id: string): Promise<Client | null> | Client | null
  touchClient(id: string, lastSeenIso: string): Promise<void> | void
  listClients(projectId: string): Promise<Client[]> | Client[]
  revokeClient(id: string): Promise<boolean> | boolean

  // API keys (programmatic read/admin)
  insertApiKey(k: ApiKey): Promise<void> | void
  findApiKeyByHash(hash: string): Promise<ApiKey | null> | ApiKey | null
  listApiKeys(projectId: string): Promise<Omit<ApiKey, "keyHash">[]> | Omit<ApiKey, "keyHash">[]
  touchApiKey(id: string, lastUsedIso: string): Promise<void> | void
  revokeApiKey(id: string): Promise<boolean> | boolean

  // Apps
  upsertApp(a: AppRecord): Promise<void> | void
  listApps(projectId: string): Promise<AppRecord[]> | AppRecord[]

  // Conversations
  upsertConversation(c: Conversation): Promise<void> | void
  getConversation(id: string): Promise<Conversation | null> | Conversation | null
  updateConversationAggregates(
    id: string,
    delta: {
      lastEventAt: string
      messageCountDelta?: number
      toolCallCountDelta?: number
      errorCountDelta?: number
      tokensInDelta?: number
      tokensOutDelta?: number
      costMicrosDelta?: number
      modelsUsed?: string[]
      status?: "active" | "completed" | "errored"
    },
  ): Promise<void> | void
  /**
   * Keyset-paginated list. Sort key `(last_event_at DESC, id DESC)`. Cursor
   * format is opaque to callers — use `encodeCursor`/`decodeCursor` from
   * `./cursor.js`. `nextCursor` is `null` on the last page.
   */
  listConversations(opts: {
    projectId: string
    appName?: string
    subject?: string
    status?: "active" | "completed" | "errored"
    limit?: number
    cursor?: string
  }): Promise<ListConversationsResult> | ListConversationsResult

  // Events
  insertEvent(e: EventRecord): Promise<void> | void
  listEventsForConversation(conversationPk: string, limit?: number): Promise<EventRecord[]> | EventRecord[]
  findLastToolUse(
    conversationPk: string,
    toolName: string,
    callId: string | null,
  ): Promise<EventRecord | null> | EventRecord | null

  // Tool calls (denormalized)
  insertToolCall(t: ToolCallRecord): Promise<void> | void
  listToolCallStats(projectId: string): Promise<
    Array<{ toolName: string; count: number; errorCount: number; avgLatencyMs: number | null }>
  > | Array<{ toolName: string; count: number; errorCount: number; avgLatencyMs: number | null }>

  // Pricing overrides
  upsertPricingRate(rate: PricingRateRow): Promise<void> | void
  getPricingRate(model: string): Promise<PricingRateRow | null> | PricingRateRow | null
  listPricingRates(): Promise<PricingRateRow[]> | PricingRateRow[]
}

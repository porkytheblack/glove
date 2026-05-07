import { createRequire } from "node:module"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type {
  ApiKey,
  AppRecord,
  Client,
  Conversation,
  CostSeriesPoint,
  EventRecord,
  ListConversationsResult,
  MonitorStorageAdapter,
  OverviewMetrics,
  PricingRateRow,
  Project,
  RegistrationToken,
  TimeseriesOpts,
  TokenSeriesPoint,
  ToolCallRecord,
} from "./types.js"
import { decodeCursor, encodeCursor } from "./cursor.js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BetterSqlite3Module = any
let cached: BetterSqlite3Module | null = null
function loadBetterSqlite3(): BetterSqlite3Module {
  if (cached) return cached
  try {
    const requireFn = createRequire(import.meta.url)
    cached = requireFn("better-sqlite3")
    return cached
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      "SqliteAdapter requires better-sqlite3, which isn't installed. Install it with:\n" +
        "  npm install better-sqlite3\n" +
        "Or use MemoryAdapter for tests / ephemeral runs.\n" +
        `Underlying error: ${reason}`,
    )
  }
}

export interface SqliteAdapterOptions {
  dbPath: string
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registration_tokens (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '["ingest"]',
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT,
  software_id TEXT,
  client_secret_hash TEXT NOT NULL,
  registration_access_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_clients_project ON clients(project_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '["read"]',
  created_at TEXT NOT NULL,
  last_used TEXT,
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS apps (
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (project_id, name)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL,
  last_event_at TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  total_tokens_in INTEGER NOT NULL DEFAULT 0,
  total_tokens_out INTEGER NOT NULL DEFAULT 0,
  total_cost_micros INTEGER NOT NULL DEFAULT 0,
  models_used TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_conv_project_app_time ON conversations(project_id, app_name, last_event_at);
CREATE INDEX IF NOT EXISTS idx_conv_subject ON conversations(project_id, subject);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  conversation_pk TEXT NOT NULL,
  project_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT,
  client_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_micros INTEGER,
  latency_ms INTEGER,
  occurred_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_conv_time ON events(conversation_pk, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_project_app_time ON events(project_id, app_name, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(project_id, type, occurred_at);
-- Serves findLastToolUse: filter by (conversation_pk, type='tool_use') and
-- order by occurred_at DESC. Without this the query scans many tool_use
-- events on busy conversations.
CREATE INDEX IF NOT EXISTS idx_events_conv_type_time ON events(conversation_pk, type, occurred_at);
-- Serves listConversations(projectId, ORDER BY last_event_at DESC) when no
-- app_name filter is supplied — the existing app_name-prefixed index is
-- useless for that case.
CREATE INDEX IF NOT EXISTS idx_conv_project_time ON conversations(project_id, last_event_at);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  conversation_pk TEXT NOT NULL,
  project_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  latency_ms INTEGER,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_tools_project_name ON tool_calls(project_id, tool_name, started_at);

CREATE TABLE IF NOT EXISTS pricing_rates (
  model TEXT PRIMARY KEY,
  input_per_1k_micros INTEGER NOT NULL,
  output_per_1k_micros INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
`

export class SqliteAdapter implements MonitorStorageAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any
  constructor(opts: SqliteAdapterOptions) {
    mkdirSync(dirname(opts.dbPath), { recursive: true })
    const Database = loadBetterSqlite3()
    this.db = new Database(opts.dbPath)
    this.db.pragma("journal_mode = WAL")
    this.db.pragma("foreign_keys = ON")
  }

  init(): void { this.db.exec(SCHEMA) }
  close(): void { this.db.close() }

  async withTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
    // better-sqlite3 ships a sync `db.transaction(fn)` wrapper which doesn't
    // accept async callbacks; we use explicit BEGIN/COMMIT/ROLLBACK so the
    // pipeline (which awaits adapter calls) can stay async-shaped.
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = await fn()
      this.db.exec("COMMIT")
      return result
    } catch (err) {
      try { this.db.exec("ROLLBACK") } catch { /* nested? */ }
      throw err
    }
  }

  // Projects
  insertProject(p: Project): void {
    this.db.prepare(
      "INSERT INTO projects (id, slug, name, created_at) VALUES (?, ?, ?, ?)",
    ).run(p.id, p.slug, p.name, p.createdAt)
  }
  getProject(id: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id)
    return row ? rowToProject(row) : null
  }
  getProjectBySlug(slug: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug)
    return row ? rowToProject(row) : null
  }
  listProjects(): Project[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all()
    return rows.map(rowToProject)
  }

  // Reg tokens
  insertRegistrationToken(t: RegistrationToken): void {
    this.db.prepare(`
      INSERT INTO registration_tokens
        (id, project_id, name, token_hash, token_prefix, scopes, created_at, expires_at, revoked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      t.id, t.projectId, t.name, t.tokenHash, t.tokenPrefix,
      JSON.stringify(t.scopes), t.createdAt, t.expiresAt, t.revoked ? 1 : 0,
    )
  }
  findRegistrationTokenByHash(hash: string): RegistrationToken | null {
    const row = this.db.prepare("SELECT * FROM registration_tokens WHERE token_hash = ?").get(hash)
    return row ? rowToRegistrationToken(row) : null
  }
  listRegistrationTokens(projectId: string): RegistrationToken[] {
    const rows = this.db.prepare(
      "SELECT * FROM registration_tokens WHERE project_id = ? ORDER BY created_at DESC",
    ).all(projectId)
    return rows.map(rowToRegistrationToken)
  }
  revokeRegistrationToken(id: string): boolean {
    const r = this.db.prepare("UPDATE registration_tokens SET revoked = 1 WHERE id = ?").run(id)
    return r.changes > 0
  }

  // Clients
  insertClient(c: Client): void {
    this.db.prepare(`
      INSERT INTO clients
        (id, project_id, name, software_id, client_secret_hash, registration_access_token_hash, created_at, last_seen, revoked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      c.id, c.projectId, c.name, c.softwareId, c.clientSecretHash,
      c.registrationAccessTokenHash, c.createdAt, c.lastSeen, c.revoked ? 1 : 0,
    )
  }
  getClient(id: string): Client | null {
    const row = this.db.prepare("SELECT * FROM clients WHERE id = ?").get(id)
    return row ? rowToClient(row) : null
  }
  touchClient(id: string, lastSeenIso: string): void {
    this.db.prepare("UPDATE clients SET last_seen = ? WHERE id = ?").run(lastSeenIso, id)
  }
  listClients(projectId: string): Client[] {
    const rows = this.db.prepare("SELECT * FROM clients WHERE project_id = ? ORDER BY created_at DESC").all(projectId)
    return rows.map(rowToClient)
  }
  revokeClient(id: string): boolean {
    const r = this.db.prepare("UPDATE clients SET revoked = 1 WHERE id = ?").run(id)
    return r.changes > 0
  }

  // API keys
  insertApiKey(k: ApiKey): void {
    this.db.prepare(`
      INSERT INTO api_keys
        (id, project_id, name, key_hash, key_prefix, scopes, created_at, last_used, expires_at, revoked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      k.id, k.projectId, k.name, k.keyHash, k.keyPrefix, JSON.stringify(k.scopes),
      k.createdAt, k.lastUsed, k.expiresAt, k.revoked ? 1 : 0,
    )
  }
  findApiKeyByHash(hash: string): ApiKey | null {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(hash)
    return row ? rowToApiKey(row) : null
  }
  listApiKeys(projectId: string): Omit<ApiKey, "keyHash">[] {
    const rows = this.db.prepare(
      "SELECT id, project_id, name, key_prefix, scopes, created_at, last_used, expires_at, revoked FROM api_keys WHERE project_id = ? ORDER BY created_at DESC",
    ).all(projectId)
    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      projectId: row.project_id as string,
      name: row.name as string,
      keyPrefix: row.key_prefix as string,
      scopes: JSON.parse(row.scopes as string),
      createdAt: row.created_at as string,
      lastUsed: (row.last_used as string | null) ?? null,
      expiresAt: (row.expires_at as string | null) ?? null,
      revoked: Boolean(row.revoked),
    }))
  }
  touchApiKey(id: string, lastUsedIso: string): void {
    this.db.prepare("UPDATE api_keys SET last_used = ? WHERE id = ?").run(lastUsedIso, id)
  }
  revokeApiKey(id: string): boolean {
    const r = this.db.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?").run(id)
    return r.changes > 0
  }

  // Apps
  upsertApp(a: AppRecord): void {
    this.db.prepare(`
      INSERT INTO apps (project_id, name, first_seen, last_seen) VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, name) DO UPDATE SET last_seen = excluded.last_seen
    `).run(a.projectId, a.name, a.firstSeen, a.lastSeen)
  }
  listApps(projectId: string): AppRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM apps WHERE project_id = ? ORDER BY last_seen DESC",
    ).all(projectId)
    return rows.map((row: Record<string, unknown>) => ({
      projectId: row.project_id as string,
      name: row.name as string,
      firstSeen: row.first_seen as string,
      lastSeen: row.last_seen as string,
    }))
  }

  // Conversations
  upsertConversation(c: Conversation): void {
    this.db.prepare(`
      INSERT INTO conversations
        (id, project_id, app_name, conversation_id, subject, user_id, client_id, status,
         started_at, last_event_at, message_count, tool_call_count, error_count,
         total_tokens_in, total_tokens_out, total_cost_micros, models_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      c.id, c.projectId, c.appName, c.conversationId, c.subject, c.userId, c.clientId, c.status,
      c.startedAt, c.lastEventAt, c.messageCount, c.toolCallCount, c.errorCount,
      c.totalTokensIn, c.totalTokensOut, c.totalCostMicros, JSON.stringify(c.modelsUsed),
    )
  }
  getConversation(id: string): Conversation | null {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id)
    return row ? rowToConversation(row) : null
  }
  updateConversationAggregates(
    id: string,
    delta: Parameters<MonitorStorageAdapter["updateConversationAggregates"]>[1],
  ): void {
    // Merge `models_used` inside the UPDATE so concurrent writers can't lose
    // entries via read-modify-write. SQLite's json1 extension is loaded by
    // default in better-sqlite3.
    let modelsExpr = "models_used"
    const params: unknown[] = []
    if (delta.modelsUsed && delta.modelsUsed.length > 0) {
      // Build a JSON array of new models, dedupe-merge with existing via
      // json_group_array(DISTINCT ...) on the union of json_each over both.
      const newModels = JSON.stringify(delta.modelsUsed)
      modelsExpr = `(
        SELECT json_group_array(value) FROM (
          SELECT value FROM json_each(models_used)
          UNION
          SELECT value FROM json_each(?)
        )
      )`
      params.push(newModels)
    }
    this.db.prepare(`
      UPDATE conversations SET
        last_event_at = ?,
        message_count = message_count + ?,
        tool_call_count = tool_call_count + ?,
        error_count = error_count + ?,
        total_tokens_in = total_tokens_in + ?,
        total_tokens_out = total_tokens_out + ?,
        total_cost_micros = total_cost_micros + ?,
        models_used = ${modelsExpr},
        status = COALESCE(?, status)
      WHERE id = ?
    `).run(
      delta.lastEventAt,
      delta.messageCountDelta ?? 0,
      delta.toolCallCountDelta ?? 0,
      delta.errorCountDelta ?? 0,
      delta.tokensInDelta ?? 0,
      delta.tokensOutDelta ?? 0,
      delta.costMicrosDelta ?? 0,
      ...params,
      delta.status ?? null,
      id,
    )
  }
  listConversations(opts: Parameters<MonitorStorageAdapter["listConversations"]>[0]): ListConversationsResult {
    const where: string[] = ["project_id = ?"]
    const params: unknown[] = [opts.projectId]
    if (opts.appName) { where.push("app_name = ?"); params.push(opts.appName) }
    if (opts.subject) { where.push("subject = ?"); params.push(opts.subject) }
    if (opts.status)  { where.push("status = ?");  params.push(opts.status) }
    // Keyset pagination: strict-less-than the cursor's (last_event_at, id).
    // Tuple comparison evaluates lexicographically in SQLite, so this fans out
    // correctly across rows that share a timestamp.
    const cursor = decodeCursor(opts.cursor)
    if (cursor) {
      where.push("(last_event_at, id) < (?, ?)")
      params.push(cursor.lastEventAt, cursor.id)
    }
    const limit = Math.max(1, opts.limit ?? 50)
    const sql = `SELECT * FROM conversations WHERE ${where.join(" AND ")} ORDER BY last_event_at DESC, id DESC LIMIT ?`
    params.push(limit)
    const rows = this.db.prepare(sql).all(...params)
    const conversations = rows.map(rowToConversation)
    const nextCursor =
      conversations.length === limit
        ? encodeCursor({
            lastEventAt: conversations[conversations.length - 1]!.lastEventAt,
            id: conversations[conversations.length - 1]!.id,
          })
        : null
    return { conversations, nextCursor }
  }

  // Events
  insertEvent(e: EventRecord): void {
    this.db.prepare(`
      INSERT INTO events
        (id, conversation_pk, project_id, app_name, conversation_id, subject, user_id, client_id,
         type, payload, model, tokens_in, tokens_out, cost_micros, latency_ms, occurred_at, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      e.id, e.conversationPk, e.projectId, e.appName, e.conversationId, e.subject, e.userId, e.clientId,
      e.type, JSON.stringify(e.payload), e.model, e.tokensIn, e.tokensOut, e.costMicros, e.latencyMs,
      e.occurredAt, e.ingestedAt,
    )
  }
  listEventsForConversation(conversationPk: string, limit = 1000): EventRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM events WHERE conversation_pk = ? ORDER BY occurred_at ASC LIMIT ?",
    ).all(conversationPk, limit)
    return rows.map(rowToEvent)
  }
  findLastToolUse(conversationPk: string, toolName: string, callId: string | null): EventRecord | null {
    // Push the JSON filter into SQL so the index handles the heavy lifting and
    // we don't scan/parse every recent tool_use in JS. `json_extract` works
    // because better-sqlite3 ships with json1 enabled.
    const sql = callId
      ? `SELECT * FROM events
         WHERE conversation_pk = ? AND type = 'tool_use'
           AND json_extract(payload, '$.name') = ?
           AND json_extract(payload, '$.id') = ?
         ORDER BY occurred_at DESC LIMIT 1`
      : `SELECT * FROM events
         WHERE conversation_pk = ? AND type = 'tool_use'
           AND json_extract(payload, '$.name') = ?
         ORDER BY occurred_at DESC LIMIT 1`
    const row = callId
      ? this.db.prepare(sql).get(conversationPk, toolName, callId)
      : this.db.prepare(sql).get(conversationPk, toolName)
    return row ? rowToEvent(row) : null
  }

  // Tool calls
  insertToolCall(t: ToolCallRecord): void {
    this.db.prepare(`
      INSERT INTO tool_calls
        (id, event_id, conversation_pk, project_id, app_name, tool_name, status, started_at, ended_at, latency_ms, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      t.id, t.eventId, t.conversationPk, t.projectId, t.appName, t.toolName, t.status,
      t.startedAt, t.endedAt, t.latencyMs, t.errorMessage,
    )
  }
  listToolCallStats(projectId: string): Array<{ toolName: string; count: number; errorCount: number; avgLatencyMs: number | null }> {
    const rows = this.db.prepare(`
      SELECT tool_name AS toolName,
             COUNT(*)  AS count,
             SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errorCount,
             AVG(latency_ms) AS avgLatencyMs
      FROM tool_calls
      WHERE project_id = ?
      GROUP BY tool_name
      ORDER BY count DESC
    `).all(projectId)
    return rows.map((row: Record<string, unknown>) => ({
      toolName: row.toolName as string,
      count: Number(row.count),
      errorCount: Number(row.errorCount),
      avgLatencyMs: row.avgLatencyMs == null ? null : Math.round(Number(row.avgLatencyMs)),
    }))
  }

  // Pricing
  upsertPricingRate(rate: PricingRateRow): void {
    this.db.prepare(`
      INSERT INTO pricing_rates (model, input_per_1k_micros, output_per_1k_micros, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(model) DO UPDATE SET
        input_per_1k_micros = excluded.input_per_1k_micros,
        output_per_1k_micros = excluded.output_per_1k_micros,
        updated_at = excluded.updated_at
    `).run(rate.model, rate.inputPer1kMicros, rate.outputPer1kMicros, rate.updatedAt)
  }
  getPricingRate(model: string): PricingRateRow | null {
    const row = this.db.prepare("SELECT * FROM pricing_rates WHERE model = ?").get(model)
    return row ? rowToPricingRate(row) : null
  }
  listPricingRates(): PricingRateRow[] {
    const rows = this.db.prepare("SELECT * FROM pricing_rates ORDER BY model ASC").all()
    return rows.map(rowToPricingRate)
  }

  // ─── Overview / time-series ────────────────────────────────────────
  getOverviewMetrics(projectId: string, sinceIso: string, untilIso: string): OverviewMetrics {
    // Tokens / cost come from `model_response_complete` (the canonical source —
    // see ingest-pipeline.ts for the rationale on skipping `token_consumption`).
    const tokensRow = this.db.prepare(`
      SELECT COALESCE(SUM(tokens_in), 0)   AS tokensIn,
             COALESCE(SUM(tokens_out), 0)  AS tokensOut,
             COALESCE(SUM(cost_micros), 0) AS costMicros
      FROM events
      WHERE project_id = ?
        AND type = 'model_response_complete'
        AND occurred_at >= ? AND occurred_at < ?
    `).get(projectId, sinceIso, untilIso) as Record<string, unknown>
    const toolsRow = this.db.prepare(`
      SELECT COUNT(*)                                                AS toolCalls,
             SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)       AS toolErrors
      FROM tool_calls
      WHERE project_id = ?
        AND started_at >= ? AND started_at < ?
    `).get(projectId, sinceIso, untilIso) as Record<string, unknown>
    const convRow = this.db.prepare(`
      SELECT COUNT(*) AS inWindow
      FROM conversations
      WHERE project_id = ?
        AND last_event_at >= ? AND last_event_at < ?
    `).get(projectId, sinceIso, untilIso) as Record<string, unknown>
    const activeRow = this.db.prepare(`
      SELECT COUNT(*) AS activeNow
      FROM conversations
      WHERE project_id = ? AND status = 'active'
    `).get(projectId) as Record<string, unknown>
    return {
      conversationsInWindow: Number(convRow.inWindow ?? 0),
      activeNow: Number(activeRow.activeNow ?? 0),
      tokensIn: Number(tokensRow.tokensIn ?? 0),
      tokensOut: Number(tokensRow.tokensOut ?? 0),
      costMicros: Number(tokensRow.costMicros ?? 0),
      toolCalls: Number(toolsRow.toolCalls ?? 0),
      toolErrors: Number(toolsRow.toolErrors ?? 0),
    }
  }

  listTimeseriesTokens(projectId: string, opts: TimeseriesOpts): TokenSeriesPoint[] {
    // strftime('%Y-%m-%dT%H:00:00Z') buckets to the hour, '%Y-%m-%dT00:00:00Z'
    // to the day. The ISO suffix keeps consumers from having to reinterpret
    // the bucket as local time.
    const fmt = opts.bucket === "hour" ? "%Y-%m-%dT%H:00:00Z" : "%Y-%m-%dT00:00:00Z"
    const rows = this.db.prepare(`
      SELECT strftime(?, occurred_at) AS bucket,
             COALESCE(SUM(tokens_in), 0)  AS tokensIn,
             COALESCE(SUM(tokens_out), 0) AS tokensOut
      FROM events
      WHERE project_id = ?
        AND type = 'model_response_complete'
        AND occurred_at >= ? AND occurred_at < ?
      GROUP BY bucket
      ORDER BY bucket ASC
    `).all(fmt, projectId, opts.since, opts.until)
    return rows.map((row: Record<string, unknown>) => ({
      bucket: row.bucket as string,
      tokensIn: Number(row.tokensIn ?? 0),
      tokensOut: Number(row.tokensOut ?? 0),
    }))
  }

  listTimeseriesCost(projectId: string, opts: TimeseriesOpts): CostSeriesPoint[] {
    const fmt = opts.bucket === "hour" ? "%Y-%m-%dT%H:00:00Z" : "%Y-%m-%dT00:00:00Z"
    const rows = this.db.prepare(`
      SELECT strftime(?, occurred_at) AS bucket,
             COALESCE(SUM(cost_micros), 0) AS costMicros
      FROM events
      WHERE project_id = ?
        AND type = 'model_response_complete'
        AND occurred_at >= ? AND occurred_at < ?
      GROUP BY bucket
      ORDER BY bucket ASC
    `).all(fmt, projectId, opts.since, opts.until)
    return rows.map((row: Record<string, unknown>) => ({
      bucket: row.bucket as string,
      costMicros: Number(row.costMicros ?? 0),
    }))
  }
}

// ─── Row mappers ─────────────────────────────────────────────────────

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    createdAt: row.created_at as string,
  }
}
function rowToRegistrationToken(row: Record<string, unknown>): RegistrationToken {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    tokenHash: row.token_hash as string,
    tokenPrefix: row.token_prefix as string,
    scopes: JSON.parse(row.scopes as string),
    createdAt: row.created_at as string,
    expiresAt: (row.expires_at as string | null) ?? null,
    revoked: Boolean(row.revoked),
  }
}
function rowToClient(row: Record<string, unknown>): Client {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: (row.name as string | null) ?? null,
    softwareId: (row.software_id as string | null) ?? null,
    clientSecretHash: row.client_secret_hash as string,
    registrationAccessTokenHash: row.registration_access_token_hash as string,
    createdAt: row.created_at as string,
    lastSeen: (row.last_seen as string | null) ?? null,
    revoked: Boolean(row.revoked),
  }
}
function rowToApiKey(row: Record<string, unknown>): ApiKey {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    keyHash: row.key_hash as string,
    keyPrefix: row.key_prefix as string,
    scopes: JSON.parse(row.scopes as string),
    createdAt: row.created_at as string,
    lastUsed: (row.last_used as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    revoked: Boolean(row.revoked),
  }
}
function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    appName: row.app_name as string,
    conversationId: row.conversation_id as string,
    subject: row.subject as string,
    userId: (row.user_id as string | null) ?? null,
    clientId: row.client_id as string,
    status: row.status as Conversation["status"],
    startedAt: row.started_at as string,
    lastEventAt: row.last_event_at as string,
    messageCount: Number(row.message_count),
    toolCallCount: Number(row.tool_call_count),
    errorCount: Number(row.error_count),
    totalTokensIn: Number(row.total_tokens_in),
    totalTokensOut: Number(row.total_tokens_out),
    totalCostMicros: Number(row.total_cost_micros),
    modelsUsed: JSON.parse(row.models_used as string),
  }
}
function rowToEvent(row: Record<string, unknown>): EventRecord {
  return {
    id: row.id as string,
    conversationPk: row.conversation_pk as string,
    projectId: row.project_id as string,
    appName: row.app_name as string,
    conversationId: row.conversation_id as string,
    subject: row.subject as string,
    userId: (row.user_id as string | null) ?? null,
    clientId: row.client_id as string,
    type: row.type as string,
    payload: JSON.parse(row.payload as string),
    model: (row.model as string | null) ?? null,
    tokensIn: row.tokens_in == null ? null : Number(row.tokens_in),
    tokensOut: row.tokens_out == null ? null : Number(row.tokens_out),
    costMicros: row.cost_micros == null ? null : Number(row.cost_micros),
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    occurredAt: row.occurred_at as string,
    ingestedAt: row.ingested_at as string,
  }
}
function rowToPricingRate(row: Record<string, unknown>): PricingRateRow {
  return {
    model: row.model as string,
    inputPer1kMicros: Number(row.input_per_1k_micros),
    outputPer1kMicros: Number(row.output_per_1k_micros),
    updatedAt: row.updated_at as string,
  }
}

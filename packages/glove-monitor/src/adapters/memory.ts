import type {
  ApiKey,
  AppRecord,
  Client,
  Conversation,
  EventRecord,
  MonitorStorageAdapter,
  PricingRateRow,
  Project,
  RegistrationToken,
  ToolCallRecord,
} from "./types.js"

export class MemoryAdapter implements MonitorStorageAdapter {
  private projects = new Map<string, Project>()
  private regTokens = new Map<string, RegistrationToken>()
  private clients = new Map<string, Client>()
  private apiKeys = new Map<string, ApiKey>()
  private apps = new Map<string, AppRecord>()
  private conversations = new Map<string, Conversation>()
  private events: EventRecord[] = []
  private toolCalls: ToolCallRecord[] = []
  private pricingRates = new Map<string, PricingRateRow>()

  init(): void {}

  async withTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
    // In-memory adapter is single-threaded and atomic by construction.
    return await fn()
  }

  insertProject(p: Project): void { this.projects.set(p.id, { ...p }) }
  getProject(id: string): Project | null { return this.projects.get(id) ?? null }
  getProjectBySlug(slug: string): Project | null {
    for (const p of this.projects.values()) if (p.slug === slug) return p
    return null
  }
  listProjects(): Project[] {
    return Array.from(this.projects.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  insertRegistrationToken(t: RegistrationToken): void { this.regTokens.set(t.id, { ...t }) }
  findRegistrationTokenByHash(hash: string): RegistrationToken | null {
    for (const t of this.regTokens.values()) if (t.tokenHash === hash) return { ...t }
    return null
  }
  listRegistrationTokens(projectId: string): RegistrationToken[] {
    return Array.from(this.regTokens.values()).filter((t) => t.projectId === projectId)
  }
  revokeRegistrationToken(id: string): boolean {
    const t = this.regTokens.get(id)
    if (!t) return false
    t.revoked = true
    return true
  }

  insertClient(c: Client): void { this.clients.set(c.id, { ...c }) }
  getClient(id: string): Client | null { return this.clients.get(id) ?? null }
  touchClient(id: string, lastSeenIso: string): void {
    const c = this.clients.get(id)
    if (c) c.lastSeen = lastSeenIso
  }
  listClients(projectId: string): Client[] {
    return Array.from(this.clients.values()).filter((c) => c.projectId === projectId)
  }
  revokeClient(id: string): boolean {
    const c = this.clients.get(id)
    if (!c) return false
    c.revoked = true
    return true
  }

  insertApiKey(k: ApiKey): void { this.apiKeys.set(k.id, { ...k }) }
  findApiKeyByHash(hash: string): ApiKey | null {
    for (const k of this.apiKeys.values()) if (k.keyHash === hash) return { ...k }
    return null
  }
  listApiKeys(projectId: string): Omit<ApiKey, "keyHash">[] {
    return Array.from(this.apiKeys.values())
      .filter((k) => k.projectId === projectId)
      .map(({ keyHash: _h, ...rest }) => rest)
  }
  touchApiKey(id: string, lastUsedIso: string): void {
    const k = this.apiKeys.get(id)
    if (k) k.lastUsed = lastUsedIso
  }
  revokeApiKey(id: string): boolean {
    const k = this.apiKeys.get(id)
    if (!k) return false
    k.revoked = true
    return true
  }

  upsertApp(a: AppRecord): void {
    const key = `${a.projectId}::${a.name}`
    const existing = this.apps.get(key)
    if (existing) {
      existing.lastSeen = a.lastSeen
    } else {
      this.apps.set(key, { ...a })
    }
  }
  listApps(projectId: string): AppRecord[] {
    return Array.from(this.apps.values()).filter((a) => a.projectId === projectId)
  }

  upsertConversation(c: Conversation): void {
    if (!this.conversations.has(c.id)) this.conversations.set(c.id, { ...c })
  }
  getConversation(id: string): Conversation | null {
    return this.conversations.get(id) ?? null
  }
  updateConversationAggregates(id: string, delta: Parameters<MonitorStorageAdapter["updateConversationAggregates"]>[1]): void {
    const c = this.conversations.get(id)
    if (!c) return
    c.lastEventAt = delta.lastEventAt
    if (delta.messageCountDelta) c.messageCount += delta.messageCountDelta
    if (delta.toolCallCountDelta) c.toolCallCount += delta.toolCallCountDelta
    if (delta.errorCountDelta) c.errorCount += delta.errorCountDelta
    if (delta.tokensInDelta) c.totalTokensIn += delta.tokensInDelta
    if (delta.tokensOutDelta) c.totalTokensOut += delta.tokensOutDelta
    if (delta.costMicrosDelta) c.totalCostMicros += delta.costMicrosDelta
    if (delta.modelsUsed) {
      const set = new Set(c.modelsUsed)
      for (const m of delta.modelsUsed) set.add(m)
      c.modelsUsed = Array.from(set)
    }
    if (delta.status) c.status = delta.status
  }
  listConversations(opts: Parameters<MonitorStorageAdapter["listConversations"]>[0]): Conversation[] {
    let results = Array.from(this.conversations.values()).filter((c) => c.projectId === opts.projectId)
    if (opts.appName) results = results.filter((c) => c.appName === opts.appName)
    if (opts.subject) results = results.filter((c) => c.subject === opts.subject)
    if (opts.status) results = results.filter((c) => c.status === opts.status)
    results.sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))
    return results.slice(0, opts.limit ?? 50)
  }

  insertEvent(e: EventRecord): void { this.events.push({ ...e }) }
  listEventsForConversation(conversationPk: string, limit = 1000): EventRecord[] {
    return this.events
      .filter((e) => e.conversationPk === conversationPk)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .slice(0, limit)
  }
  findLastToolUse(conversationPk: string, toolName: string, callId: string | null): EventRecord | null {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i]!
      if (e.conversationPk !== conversationPk) continue
      if (e.type !== "tool_use") continue
      const payload = e.payload as { name?: string; id?: string }
      if (payload.name !== toolName) continue
      if (callId && payload.id !== callId) continue
      return e
    }
    return null
  }

  insertToolCall(t: ToolCallRecord): void { this.toolCalls.push({ ...t }) }
  listToolCallStats(projectId: string): Array<{ toolName: string; count: number; errorCount: number; avgLatencyMs: number | null }> {
    const byTool = new Map<string, { count: number; errorCount: number; latencySum: number; latencyCount: number }>()
    for (const tc of this.toolCalls) {
      if (tc.projectId !== projectId) continue
      const slot = byTool.get(tc.toolName) ?? { count: 0, errorCount: 0, latencySum: 0, latencyCount: 0 }
      slot.count++
      if (tc.status === "error") slot.errorCount++
      if (typeof tc.latencyMs === "number") {
        slot.latencySum += tc.latencyMs
        slot.latencyCount++
      }
      byTool.set(tc.toolName, slot)
    }
    return Array.from(byTool.entries()).map(([toolName, s]) => ({
      toolName,
      count: s.count,
      errorCount: s.errorCount,
      avgLatencyMs: s.latencyCount ? Math.round(s.latencySum / s.latencyCount) : null,
    }))
  }

  upsertPricingRate(rate: PricingRateRow): void { this.pricingRates.set(rate.model, { ...rate }) }
  getPricingRate(model: string): PricingRateRow | null { return this.pricingRates.get(model) ?? null }
  listPricingRates(): PricingRateRow[] {
    return Array.from(this.pricingRates.values()).sort((a, b) => a.model.localeCompare(b.model))
  }
}

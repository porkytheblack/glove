import type {
  SubscriberAdapter,
  SubscriberEvent,
  SubscriberEventDataMap,
} from "glove-core"
import { BatchedQueue } from "./queue.js"
import { DcrClient } from "./dcr-client.js"
import { FsCredentialStorage, type CredentialStorage } from "./storage.js"
import type { IngestEvent, IngestPayload } from "./shared/types.js"

export interface MonitorSubscriberOptions {
  /** Base URL of the glove-monitor server, e.g. https://monitor.example.com */
  url: string
  /** Project registration token. Required on first run; cached locally afterwards. */
  registrationToken?: string
  /** Developer-defined namespace for this app, e.g. "prod-chatbot". */
  app: string
  /**
   * Model name (e.g. "claude-opus-4-7"). Optional but strongly recommended:
   * `glove-core`'s `SubscriberEvent` does not carry the model name on
   * `model_response*` events, so the subscriber injects this value at the
   * boundary so the server can compute cost and aggregate by model.
   * Resolver function form is supported for runtime-switchable models.
   */
  model?: string | (() => string | undefined)
  /** Resolves the conversation identifier per event. Defaults to a static seed. */
  conversationId?: () => string
  /** Resolves the optional end-user identifier. Falls back to the DCR'd client_id server-side. */
  getUserId?: () => string | undefined | null
  /** Override storage backend for cached client credentials. */
  storage?: CredentialStorage
  /** Optional override for `fetch` (testing). */
  fetch?: typeof globalThis.fetch
  /** Optional readable client name shown in dashboard /clients. */
  clientName?: string
  softwareId?: string
  flushIntervalMs?: number
  maxBatchSize?: number
  onError?: (err: unknown) => void
}

export class MonitorSubscriber implements SubscriberAdapter {
  private readonly url: string
  private readonly app: string
  private readonly conversationIdFn: () => string
  private readonly getUserId?: () => string | undefined | null
  private readonly modelFn?: () => string | undefined
  private readonly fetchFn: typeof globalThis.fetch
  private readonly dcr: DcrClient
  private readonly queue: BatchedQueue<{ conversationId: string; userId: string | null; event: IngestEvent }>
  private readonly onError?: (err: unknown) => void

  constructor(opts: MonitorSubscriberOptions) {
    this.url = opts.url.replace(/\/+$/, "")
    this.app = opts.app
    this.conversationIdFn = opts.conversationId ?? (() => `glove_${Date.now()}`)
    this.getUserId = opts.getUserId
    this.modelFn = typeof opts.model === "function"
      ? (opts.model as () => string | undefined)
      : opts.model != null
        ? () => opts.model as string
        : undefined
    this.fetchFn = opts.fetch ?? globalThis.fetch
    this.onError = opts.onError

    const storage = opts.storage ?? new FsCredentialStorage()
    this.dcr = new DcrClient({
      url: this.url,
      registrationToken: opts.registrationToken ?? process.env.GLOVE_MONITOR_REG_TOKEN,
      clientName: opts.clientName ?? this.app,
      softwareId: opts.softwareId,
      storage,
      storageKey: `${this.url}|${opts.registrationToken ?? process.env.GLOVE_MONITOR_REG_TOKEN ?? "anon"}`,
      fetch: this.fetchFn,
    })

    this.queue = new BatchedQueue({
      flushIntervalMs: opts.flushIntervalMs ?? 1000,
      maxBatchSize: opts.maxBatchSize ?? 50,
      onError: this.onError,
      send: async (batch) => {
        // Group by conversation_id+user_id to keep payloads consistent.
        const groups = new Map<string, { conversationId: string; userId: string | null; events: IngestEvent[] }>()
        for (const item of batch) {
          const key = `${item.conversationId}::${item.userId ?? ""}`
          const slot = groups.get(key) ?? { conversationId: item.conversationId, userId: item.userId, events: [] }
          slot.events.push(item.event)
          groups.set(key, slot)
        }
        for (const g of groups.values()) {
          await this.send({
            app: this.app,
            conversation_id: g.conversationId,
            user_id: g.userId ?? undefined,
            events: g.events,
          })
        }
      },
    })
  }

  async record<T extends SubscriberEvent["type"]>(
    event_type: T,
    data: SubscriberEventDataMap[T],
  ): Promise<void> {
    const conversationId = this.conversationIdFn()
    const userId = this.getUserId ? (this.getUserId() ?? null) : null
    const enriched: Record<string, unknown> = { ...data }
    // glove-core's SubscriberEvent shape doesn't carry the model name on model_response*
    // events; inject it here so the server can compute cost and roll up aggregates.
    if ((event_type === "model_response" || event_type === "model_response_complete") && this.modelFn) {
      const m = this.modelFn()
      if (m && enriched.model == null) enriched.model = m
    }
    const event = { type: event_type, occurred_at: new Date().toISOString(), ...enriched } as unknown as IngestEvent
    this.queue.enqueue({ conversationId, userId, event })
  }

  async flush(): Promise<void> { await this.queue.flush() }
  async close(): Promise<void> { await this.queue.flush(); await this.queue.close() }

  /**
   * Direct (non-queued) send. The caller supplies the full payload with
   * server-trusted identity. Used by the relay route handler to forward
   * browser events with overridden user_id, bypassing the local queue so
   * the relay's HTTP response surfaces upstream errors synchronously.
   */
  async sendDirect(payload: IngestPayload): Promise<void> {
    await this.send(payload, true)
  }

  private async send(payload: IngestPayload, retry = true): Promise<void> {
    const accessToken = await this.dcr.getAccessToken()
    const res = await this.fetchFn(`${this.url}/api/v1/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    })
    if (res.ok) return
    if (res.status === 401 && retry) {
      // Refresh access token and try once. If still 401, drop credentials and re-DCR.
      try {
        await this.dcr.getAccessToken(true)
      } catch {
        await this.dcr.reset()
      }
      return this.send(payload, false)
    }
    if (res.status === 401 && !retry) {
      // Re-DCR'd and still 401 — credentials revoked. Drop cache, surface error.
      await this.dcr.reset()
      throw new Error(`monitor ingest 401 after re-DCR — client revoked?`)
    }
    const text = await res.text().catch(() => "")
    throw new Error(`monitor ingest failed: ${res.status} ${text}`)
  }
}

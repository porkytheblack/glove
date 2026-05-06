import type {
  SubscriberAdapter,
  SubscriberEvent,
  SubscriberEventDataMap,
} from "glove-core"
import { BatchedQueue } from "../queue.js"
import type { IngestEvent } from "../shared/types.js"

export interface BrowserMonitorSubscriberOptions {
  /** Relative path on the developer's own backend, e.g. "/api/glove-monitor/ingest". */
  relayUrl: string
  /** Developer-defined namespace for this app. */
  app: string
  /**
   * Model name (e.g. "claude-opus-4-7"). Injected into model_response*
   * events so the server can compute cost and aggregate by model.
   */
  model?: string | (() => string | undefined)
  /** Resolves the conversation identifier per event. */
  conversationId?: () => string
  /** Optional per-batch headers (e.g. CSRF token). */
  headers?: () => Record<string, string>
  flushIntervalMs?: number
  maxBatchSize?: number
  onError?: (err: unknown) => void
}

interface QueueItem {
  conversationId: string
  event: IngestEvent
}

/**
 * Browser-safe subscriber. Carries no credentials. POSTs batched events to a
 * relative URL on the developer's own backend (which then proxies to
 * glove-monitor with cached DCR'd credentials).
 *
 * Auth cookies on the dev's own origin ride along automatically via
 * `credentials: "same-origin"`. The relay handler is responsible for
 * authenticating the user and overriding `user_id` server-side.
 */
export class BrowserMonitorSubscriber implements SubscriberAdapter {
  private readonly app: string
  private readonly relayUrl: string
  private readonly conversationIdFn: () => string
  private readonly headersFn?: () => Record<string, string>
  private readonly modelFn?: () => string | undefined
  private readonly queue: BatchedQueue<QueueItem>
  private terminal = false
  private readonly onError?: (err: unknown) => void

  constructor(opts: BrowserMonitorSubscriberOptions) {
    this.app = opts.app
    this.relayUrl = opts.relayUrl
    this.conversationIdFn = opts.conversationId ?? (() => `glove_${Date.now()}`)
    this.headersFn = opts.headers
    this.onError = opts.onError
    this.modelFn = typeof opts.model === "function"
      ? (opts.model as () => string | undefined)
      : opts.model != null
        ? () => opts.model as string
        : undefined

    this.queue = new BatchedQueue({
      flushIntervalMs: opts.flushIntervalMs ?? 1000,
      maxBatchSize: opts.maxBatchSize ?? 50,
      onError: opts.onError,
      send: async (batch) => {
        const groups = new Map<string, IngestEvent[]>()
        for (const item of batch) {
          const slot = groups.get(item.conversationId) ?? []
          slot.push(item.event)
          groups.set(item.conversationId, slot)
        }
        for (const [conversationId, events] of groups) {
          await this.send(conversationId, events)
        }
      },
    })

    // Best-effort flush via sendBeacon on tab close / SPA navigation. Beacon
    // requests are queued by the browser even if the page unloads, but we
    // can't honour same-origin cookies if the user signed out — that's fine,
    // the relay handler will 401 and silently drop, no further retry.
    if (typeof window !== "undefined") {
      const flushOnUnload = (): void => { this.flushBeacon() }
      window.addEventListener("pagehide", flushOnUnload)
      window.addEventListener("beforeunload", flushOnUnload)
    }
  }

  private flushBeacon(): void {
    if (this.terminal) return
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return
    // Snapshot whatever's currently queued and ship it as one beacon per conversation.
    const drained = (this.queue as unknown as { buffer: QueueItem[] }).buffer.splice(0)
    if (drained.length === 0) return
    const groups = new Map<string, IngestEvent[]>()
    for (const item of drained) {
      const slot = groups.get(item.conversationId) ?? []
      slot.push(item.event)
      groups.set(item.conversationId, slot)
    }
    for (const [conversationId, events] of groups) {
      try {
        const blob = new Blob([JSON.stringify({ app: this.app, conversation_id: conversationId, events })], {
          type: "application/json",
        })
        navigator.sendBeacon(this.relayUrl, blob)
      } catch {
        // sendBeacon can throw if size > UA limit; nothing reasonable to do during unload.
      }
    }
  }

  async record<T extends SubscriberEvent["type"]>(
    event_type: T,
    data: SubscriberEventDataMap[T],
  ): Promise<void> {
    if (this.terminal) return
    const enriched: Record<string, unknown> = { ...data }
    if ((event_type === "model_response" || event_type === "model_response_complete") && this.modelFn) {
      const m = this.modelFn()
      if (m && enriched.model == null) enriched.model = m
    }
    const event = { type: event_type, occurred_at: new Date().toISOString(), ...enriched } as unknown as IngestEvent
    this.queue.enqueue({ conversationId: this.conversationIdFn(), event })
  }

  async flush(): Promise<void> { await this.queue.flush() }
  async close(): Promise<void> { await this.queue.flush(); await this.queue.close() }

  private async send(conversationId: string, events: IngestEvent[]): Promise<void> {
    if (this.terminal) return
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(this.headersFn?.() ?? {}),
    }
    const res = await fetch(this.relayUrl, {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({
        app: this.app,
        conversation_id: conversationId,
        events,
      }),
    })
    if (res.ok) return
    if (res.status === 401 || res.status === 403) {
      // Auth failed on the dev's backend. Treat as terminal — re-auth must
      // happen out-of-band on the dev's side. Stop the queue so we don't
      // spin forever on exponential backoff against a permanent failure.
      this.terminal = true
      this.onError?.(new Error(`relay returned ${res.status} — subscriber stopped`))
      void this.queue.close()
      return
    }
    const text = await res.text().catch(() => "")
    throw new Error(`relay failed: ${res.status} ${text}`)
  }
}

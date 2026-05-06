/**
 * Generic batched + retried delivery queue. Browser-safe (no node imports).
 * Mirrors the queue/drain/back-off pattern from glovebox-kit/src/ws-subscriber.ts.
 */

export interface QueueOptions<T> {
  flushIntervalMs?: number
  maxBatchSize?: number
  maxQueueSize?: number
  /**
   * Send one batch. Throw to signal failure — items will be re-queued and
   * delivery will back off. `signalRetry` true means caller should not throw
   * again immediately (e.g. 401 → re-auth in flight).
   */
  send: (batch: T[]) => Promise<void>
  onError?: (err: unknown) => void
}

export class BatchedQueue<T> {
  private buffer: T[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private draining = false
  private closed = false
  private backoffMs = 0
  private readonly opts: Required<Omit<QueueOptions<T>, "onError" | "send">> &
    Pick<QueueOptions<T>, "send" | "onError">

  constructor(options: QueueOptions<T>) {
    this.opts = {
      flushIntervalMs: options.flushIntervalMs ?? 1000,
      maxBatchSize: options.maxBatchSize ?? 50,
      maxQueueSize: options.maxQueueSize ?? 5000,
      send: options.send,
      onError: options.onError,
    }
  }

  enqueue(item: T): void {
    if (this.closed) return
    if (this.buffer.length >= this.opts.maxQueueSize) {
      // Drop oldest. Keep the queue from growing unbounded under outage.
      this.buffer.shift()
    }
    this.buffer.push(item)
    if (this.buffer.length >= this.opts.maxBatchSize) {
      void this.flush()
    } else {
      this.scheduleFlush()
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.draining || this.closed) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, this.opts.flushIntervalMs)
  }

  async flush(): Promise<void> {
    if (this.draining || this.closed) return
    if (this.buffer.length === 0) return
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.draining = true
    while (this.buffer.length > 0 && !this.closed) {
      const batch = this.buffer.splice(0, this.opts.maxBatchSize)
      try {
        await this.opts.send(batch)
        this.backoffMs = 0
      } catch (err) {
        this.opts.onError?.(err)
        // Requeue at the front and back off
        this.buffer.unshift(...batch)
        this.backoffMs = Math.min(this.backoffMs ? this.backoffMs * 2 : 200, 30_000)
        await new Promise((r) => setTimeout(r, this.backoffMs))
      }
    }
    this.draining = false
    if (this.buffer.length > 0) this.scheduleFlush()
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }
}

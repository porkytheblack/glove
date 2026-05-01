import type { SubscriberAdapter, SubscriberEvent, SubscriberEventDataMap } from "glove-core"
import type { ServerMessage } from "glovebox/protocol"

/**
 * Subscriber that buffers events and drains them to the WS asynchronously.
 *
 * `record` returns immediately so the agent loop never stalls on network
 * latency. A drain loop reads from the queue and calls the supplied `send`
 * function; if `send` rejects, the message is requeued at the front and the
 * loop sleeps before retrying.
 */
export class WsSubscriber implements SubscriberAdapter {
  private queue: ServerMessage[] = []
  private requestId: string
  private waker: (() => void) | null = null
  private running = false
  private closed = false

  constructor(
    requestId: string,
    private send: (msg: ServerMessage) => Promise<void>,
  ) {
    this.requestId = requestId
    void this.runDrain()
  }

  setRequestId(id: string): void {
    this.requestId = id
  }

  async record<T extends SubscriberEvent["type"]>(
    event_type: T,
    data: SubscriberEventDataMap[T],
  ): Promise<void> {
    if (this.closed) return
    this.enqueue({
      type: "event",
      id: this.requestId,
      event_type,
      data: data as unknown,
    })
  }

  /** Inject any server message into the same drain queue (used by the display bridge). */
  enqueue(msg: ServerMessage): void {
    if (this.closed) return
    this.queue.push(msg)
    this.wake()
  }

  close(): void {
    this.closed = true
    this.wake()
  }

  private wake(): void {
    if (this.waker) {
      const w = this.waker
      this.waker = null
      w()
    }
  }

  private async runDrain(): Promise<void> {
    if (this.running) return
    this.running = true
    while (!this.closed) {
      if (this.queue.length === 0) {
        await new Promise<void>((resolve) => {
          this.waker = resolve
        })
        continue
      }
      const msg = this.queue.shift()!
      try {
        await this.send(msg)
      } catch (err) {
        // Requeue at the front and back off briefly.
        this.queue.unshift(msg)
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    this.running = false
  }
}

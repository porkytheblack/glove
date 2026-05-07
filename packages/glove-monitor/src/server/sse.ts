export interface SSEEvent {
  projectId: string
  event: string
  data: unknown
  id?: string
}

export interface SSEClient {
  projectId: string | null
  controller: ReadableStreamDefaultController<Uint8Array>
}

export class SSEHub {
  private clients = new Set<SSEClient>()
  private encoder = new TextEncoder()
  private nextId = 0

  add(client: SSEClient): () => void {
    this.clients.add(client)
    return () => this.clients.delete(client)
  }

  /**
   * Emit as a default-message SSE frame (no `event:` line). Setting the
   * `event:` field makes the frame a *named* event, which `EventSource.onmessage`
   * does NOT fire for — only `addEventListener('foo', ...)` would. Keeping
   * everything on the default `message` channel means clients can use
   * `onmessage` and filter on `data.type`. The `event` field on `SSEEvent`
   * is preserved for API symmetry with `WebSocketHub` but stamped into the
   * data envelope for client consumption.
   */
  broadcast(ev: SSEEvent): void {
    const id = ev.id ?? String(++this.nextId)
    const envelope = JSON.stringify(ev.data)
    const lines = [
      `id: ${id}`,
      `data: ${envelope}`,
      "",
      "",
    ].join("\n")
    const bytes = this.encoder.encode(lines)
    for (const c of this.clients) {
      if (c.projectId && c.projectId !== ev.projectId) continue
      try { c.controller.enqueue(bytes) } catch { this.clients.delete(c) }
    }
  }

  heartbeatAll(): void {
    const bytes = this.encoder.encode(": ping\n\n")
    for (const c of this.clients) {
      try { c.controller.enqueue(bytes) } catch { this.clients.delete(c) }
    }
  }

  count(): number { return this.clients.size }
}

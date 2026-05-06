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

  broadcast(ev: SSEEvent): void {
    const id = ev.id ?? String(++this.nextId)
    const lines = [
      `event: ${ev.event}`,
      `id: ${id}`,
      `data: ${JSON.stringify(ev.data)}`,
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

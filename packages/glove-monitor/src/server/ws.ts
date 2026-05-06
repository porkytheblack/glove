import type { WebSocket } from "ws"

export interface WsClient {
  ws: WebSocket
  projectId: string | null
}

export interface WsBroadcast {
  projectId: string
  event: string
  data: unknown
}

export class WebSocketHub {
  private clients = new Set<WsClient>()

  add(client: WsClient): () => void {
    this.clients.add(client)
    client.ws.on("close", () => this.clients.delete(client))
    return () => this.clients.delete(client)
  }

  broadcast(b: WsBroadcast): void {
    const msg = JSON.stringify({ event: b.event, data: b.data })
    for (const c of this.clients) {
      if (c.projectId && c.projectId !== b.projectId) continue
      try { c.ws.send(msg) } catch { this.clients.delete(c) }
    }
  }

  count(): number { return this.clients.size }
}

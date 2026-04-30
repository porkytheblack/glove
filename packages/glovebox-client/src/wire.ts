/** Browser-or-Node WebSocket type and constructor unification. */
export type WsLike = {
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: "open", listener: () => void): void
  addEventListener(type: "close", listener: () => void): void
  addEventListener(type: "error", listener: (event: { message?: string }) => void): void
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void
}

export type WsCtor = new (url: string, protocols?: string | string[], options?: { headers?: Record<string, string> }) => WsLike

/**
 * Pick a WebSocket implementation. In Node we use `ws`; in browsers we use
 * the native `WebSocket`. Auth headers only work in Node — in the browser
 * the bearer must be passed via subprotocol.
 */
export async function pickWebSocket(): Promise<WsCtor> {
  if (typeof globalThis !== "undefined" && typeof (globalThis as any).WebSocket === "function") {
    return (globalThis as any).WebSocket as WsCtor
  }
  const mod = await import("ws")
  return mod.WebSocket as unknown as WsCtor
}

export function isNodeWebSocket(ctor: WsCtor): boolean {
  return typeof globalThis === "undefined" || (globalThis as any).WebSocket !== ctor
}

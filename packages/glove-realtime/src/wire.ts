// Shared plumbing for adapters: the socket slice they use, PCM/base64, frame
// decoding, and the listener set behind `subscribe`.

import type {
  RealtimeEvent,
  RealtimeHistoryItem,
  RealtimeListener,
  RealtimeMedia,
  RealtimeSessionSpec,
} from "./types";

/** The slice of the WebSocket API adapters use. Fakes implement just this. */
export interface WebSocketLike {
  send(data: string | ArrayBufferLike): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", fn: (ev: any) => void): void;
  readyState: number;
}

export function int16ToBase64(pcm: Int16Array): string {
  return bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
}

export function base64ToInt16(b64: string): Int16Array {
  const bytes = base64ToBytes(b64);
  // Copy into an aligned buffer: an odd byteOffset can't back an Int16Array.
  const aligned = new Uint8Array(bytes.byteLength - (bytes.byteLength % 2));
  aligned.set(bytes.subarray(0, aligned.byteLength));
  return new Int16Array(aligned.buffer);
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function mediaBase64(media: RealtimeMedia): string {
  return typeof media.data === "string" ? media.data : bytesToBase64(media.data);
}

/**
 * Socket frames arrive as text, ArrayBuffer, a Node Buffer or a Blob depending
 * on the provider and the runtime. Gemini sends JSON over BINARY frames, so a
 * plain `String(data)` turns every message into "[object Blob]" and the
 * session goes silent. Decode by type instead.
 */
export function decodeFrame(raw: unknown, handle: (text: string) => void): void {
  if (typeof raw === "string") return handle(raw);
  if (typeof Blob !== "undefined" && raw instanceof Blob) {
    void raw.text().then(handle).catch(() => {});
    return;
  }
  if (raw instanceof ArrayBuffer) return handle(new TextDecoder().decode(raw));
  if (ArrayBuffer.isView(raw)) {
    return handle(new TextDecoder().decode(raw as Uint8Array));
  }
  handle(String(raw));
}

export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Render seed history as one block, for providers that can only take text. */
export function renderHistory(history: RealtimeHistoryItem[]): string {
  return history.map((item) => `${item.role}: ${item.text}`).join("\n");
}

/**
 * The parts every adapter shares: the listener set, the last spec (so a
 * reconnect can reuse it), and a socket-open helper with a timeout.
 */
export abstract class AdapterBase {
  private readonly listeners = new Set<RealtimeListener>();
  /** The spec the current session was opened with, kept current by setTools /
   *  setInstructions so a reconnect reopens the session as it is now. */
  protected spec: RealtimeSessionSpec = {};

  subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected emit(event: RealtimeEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        // A throwing listener must not stop the others or break the socket
        // handler that is dispatching. Report it, unless it was the error
        // report itself that threw.
        if (event.type !== "error") {
          this.emit({ type: "error", error: asError(error), fatal: false });
        }
      }
    }
  }

  protected fail(message: string, fatal = false): void {
    this.emit({ type: "error", error: new Error(message), fatal });
  }
}

/** Await a socket's `open`, rejecting on error/close/timeout. */
export function awaitOpen(ws: WebSocketLike, timeoutMs: number, label: string): Promise<void> {
  if (ws.readyState === 1) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => settle(new Error(`${label} connect timed out`)), timeoutMs);
    ws.addEventListener("open", () => settle());
    ws.addEventListener("error", (ev: { message?: string; error?: { message?: string } }) =>
      settle(new Error(`${label} connect failed: ${ev?.error?.message ?? ev?.message ?? "socket error"}`)),
    );
    ws.addEventListener("close", (ev: { code?: number; reason?: string }) =>
      settle(new Error(`${label} closed before opening (${ev?.code ?? "?"})${ev?.reason ? `: ${ev.reason}` : ""}`)),
    );
  });
}

/** Resolve a factory-or-default socket. Global WebSocket exists in browsers and Node 22+. */
export function defaultSocket(url: string, protocols?: string[]): WebSocketLike {
  if (typeof WebSocket === "undefined") {
    throw new Error("No global WebSocket in this runtime: pass socketFactory (Node < 22).");
  }
  return new WebSocket(url, protocols) as unknown as WebSocketLike;
}

/** `close()` was called while `open()` was still connecting. */
export class OpenCancelled extends Error {
  constructor(provider: string) {
    super(`${provider} open cancelled: the session was closed while connecting`);
    this.name = "OpenCancelled";
  }
}

import type {
  ClientMessage,
  FileRef,
  ServerMessage,
  SubscriberEventType,
  WireSlot,
} from "glovebox/protocol"

import { DefaultClientStorage, type ClientStorage } from "./storage"
import { httpFromWs, pickWebSocket, type WsLike } from "./wire"

export interface BoxEndpoint {
  url: string
  key: string
}

export interface BoxOptions {
  endpoint: BoxEndpoint
  storage?: ClientStorage
  /**
   * Reconnect attempts on connection drop. Default 3, exponential backoff
   * 500ms / 1s / 2s.
   */
  reconnectAttempts?: number
}

export interface PromptOptions {
  /** Caller-supplied input files. Bytes get wrapped via the configured ClientStorage. */
  files?: Record<string, { mime?: string; bytes: Uint8Array }>
  /** Pre-computed FileRefs (bypasses ClientStorage). Merged with `files`. */
  inputs?: Record<string, FileRef>
}

export interface SubscriberEvent {
  request_id: string
  event_type: SubscriberEventType
  data: unknown
}

export interface DisplayEvent {
  type: "push" | "clear"
  slot?: WireSlot
  slot_id?: string
}

export interface PromptResult {
  /** Async iterable of subscriber events (text deltas, tool uses, etc.). */
  events: AsyncIterable<SubscriberEvent>
  /** Async iterable of display slot pushes/clears. */
  display: AsyncIterable<DisplayEvent>
  /** Resolves with the final assistant message. */
  message: Promise<string>
  /** Resolves with the final outputs map. */
  outputs: Promise<Record<string, FileRef>>
  /** Read an output file's bytes through the configured storage. */
  read(name: string): Promise<Uint8Array>
  /** Send a display resolution back to the server. */
  resolve(slot_id: string, value: unknown): void
  /** Send a display rejection back to the server. */
  reject(slot_id: string, error: unknown): void
  /** Abort this prompt. */
  abort(): void
}

export interface BoxEnvironment {
  name: string
  version: string
  base: string
  fs: Record<string, { path: string; writable: boolean }>
  packages: { apt?: string[]; pip?: string[]; npm?: string[] }
  limits?: { cpu?: string; memory?: string; timeout?: string }
  protocol_version: 1
}

interface AsyncQueue<T> {
  push(value: T): void
  close(): void
  iter(): AsyncIterable<T>
}

function asyncQueue<T>(): AsyncQueue<T> {
  const buf: T[] = []
  let waker: ((v: IteratorResult<T>) => void) | null = null
  let closed = false

  const next = (): Promise<IteratorResult<T>> => {
    if (buf.length > 0) return Promise.resolve({ value: buf.shift()!, done: false })
    if (closed) return Promise.resolve({ value: undefined, done: true })
    return new Promise((resolve) => {
      waker = resolve
    })
  }

  return {
    push(value) {
      if (closed) return
      if (waker) {
        const w = waker
        waker = null
        w({ value, done: false })
      } else {
        buf.push(value)
      }
    },
    close() {
      closed = true
      if (waker) {
        const w = waker
        waker = null
        w({ value: undefined as unknown as T, done: true })
      }
    },
    iter() {
      return { [Symbol.asyncIterator]: () => ({ next }) }
    },
  }
}

interface InflightPrompt {
  events: AsyncQueue<SubscriberEvent>
  display: AsyncQueue<DisplayEvent>
  resolveMessage: (s: string) => void
  rejectMessage: (e: unknown) => void
  resolveOutputs: (o: Record<string, FileRef>) => void
  rejectOutputs: (e: unknown) => void
}

export class Box {
  private ws: WsLike | null = null
  private opening: Promise<WsLike> | null = null
  private closed = false
  private nextId = 1
  private readonly inflight = new Map<string, InflightPrompt>()
  private readonly storage: ClientStorage

  constructor(private readonly opts: BoxOptions) {
    this.storage = opts.storage ?? new DefaultClientStorage()
  }

  get bearer(): string {
    return this.opts.endpoint.key
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.ws) this.ws.close(1000, "client closed")
    for (const inflight of this.inflight.values()) {
      inflight.events.close()
      inflight.display.close()
      inflight.rejectMessage(new Error("Connection closed"))
      inflight.rejectOutputs(new Error("Connection closed"))
    }
    this.inflight.clear()
  }

  prompt(text: string, opts?: PromptOptions): PromptResult {
    if (this.closed) throw new Error("Box is closed")
    const id = `req_${this.nextId++}`
    const events = asyncQueue<SubscriberEvent>()
    const display = asyncQueue<DisplayEvent>()

    let resolveMessage: (s: string) => void = () => undefined
    let rejectMessage: (e: unknown) => void = () => undefined
    const messagePromise = new Promise<string>((res, rej) => {
      resolveMessage = res
      rejectMessage = rej
    })

    let resolveOutputs: (o: Record<string, FileRef>) => void = () => undefined
    let rejectOutputs: (e: unknown) => void = () => undefined
    const outputsPromise = new Promise<Record<string, FileRef>>((res, rej) => {
      resolveOutputs = res
      rejectOutputs = rej
    })

    this.inflight.set(id, {
      events,
      display,
      resolveMessage,
      rejectMessage,
      resolveOutputs,
      rejectOutputs,
    })

    void this.dispatchPrompt(id, text, opts).catch((err) => {
      const inflight = this.inflight.get(id)
      if (inflight) {
        inflight.events.close()
        inflight.display.close()
        inflight.rejectMessage(err)
        inflight.rejectOutputs(err)
        this.inflight.delete(id)
      }
    })

    const sendOrEmit = (msg: ClientMessage) => {
      this.send(msg).catch((err) => {
        this.emitSendError(err)
      })
    }

    const result: PromptResult = {
      events: events.iter(),
      display: display.iter(),
      message: messagePromise,
      outputs: outputsPromise,
      read: async (name: string) => {
        const outputs = await outputsPromise
        const ref = outputs[name]
        if (!ref) throw new Error(`No output named ${name}`)
        return this.storage.get(ref, { bearer: this.bearer })
      },
      resolve: (slot_id, value) => sendOrEmit({ type: "display_resolve", slot_id, value }),
      reject: (slot_id, error) => sendOrEmit({ type: "display_reject", slot_id, error }),
      abort: () => sendOrEmit({ type: "abort", id }),
    }
    return result
  }

  /**
   * Fetch the deployed glovebox's environment spec — useful for routing
   * decisions when an app holds many endpoints. Cached after first fetch.
   */
  async environment(): Promise<BoxEnvironment> {
    if (this.envCache) return this.envCache
    const url = httpFromWs(this.opts.endpoint.url, "/environment")
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.bearer}` },
    })
    if (!res.ok) {
      throw new Error(`environment fetch failed: ${res.status} ${res.statusText}`)
    }
    const env = (await res.json()) as BoxEnvironment
    this.envCache = env
    return env
  }

  /** Subscribe to send-side errors that escape `void this.send(...)` callsites. */
  onSendError(listener: (err: unknown) => void): () => void {
    this.sendErrorListeners.add(listener)
    return () => this.sendErrorListeners.delete(listener)
  }

  private envCache?: BoxEnvironment
  private sendErrorListeners = new Set<(err: unknown) => void>()
  private emitSendError(err: unknown): void {
    if (this.sendErrorListeners.size === 0) {
      // No listener — surface to the console so the failure doesn't disappear.
      console.warn("[glovebox-client] send failed:", err)
      return
    }
    for (const fn of this.sendErrorListeners) {
      try { fn(err) } catch { /* ignore */ }
    }
  }

  // ─── internals ────────────────────────────────────────────────────────

  private async dispatchPrompt(id: string, text: string, opts?: PromptOptions): Promise<void> {
    const inputs: Record<string, FileRef> = { ...(opts?.inputs ?? {}) }
    if (opts?.files) {
      for (const [name, f] of Object.entries(opts.files)) {
        inputs[name] = await this.storage.put(name, f.mime ?? "application/octet-stream", f.bytes)
      }
    }
    await this.send({ type: "prompt", id, text, inputs })
  }

  private async send(msg: ClientMessage): Promise<void> {
    const ws = await this.ensureOpen()
    ws.send(JSON.stringify(msg))
  }

  private async ensureOpen(): Promise<WsLike> {
    if (this.ws) return this.ws
    if (this.opening) return this.opening
    this.opening = this.openSocket()
    try {
      this.ws = await this.opening
      return this.ws
    } finally {
      this.opening = null
    }
  }

  private async openSocket(): Promise<WsLike> {
    const Ctor = await pickWebSocket()
    const headers = { Authorization: `Bearer ${this.opts.endpoint.key}` }
    const ws = new Ctor(this.opts.endpoint.url, undefined, { headers })

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve())
      ws.addEventListener("error", (event) => reject(new Error(event.message ?? "websocket error")))
    })

    ws.addEventListener("message", (event) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as ServerMessage
      } catch {
        return
      }
      this.handleMessage(msg)
    })

    ws.addEventListener("close", () => {
      this.ws = null
      // Active prompts are dropped on close; future v2 work: reconnect + resume.
      for (const [, inflight] of this.inflight) {
        inflight.events.close()
        inflight.display.close()
        inflight.rejectMessage(new Error("Connection closed"))
        inflight.rejectOutputs(new Error("Connection closed"))
      }
      this.inflight.clear()
    })

    return ws
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "event": {
        const inflight = this.inflight.get(msg.id)
        if (inflight) {
          inflight.events.push({
            request_id: msg.id,
            event_type: msg.event_type,
            data: msg.data,
          })
        }
        return
      }
      case "display_push": {
        // Display events are session-scoped, not request-scoped, so they fan
        // out to every active prompt's display stream.
        for (const inflight of this.inflight.values()) {
          inflight.display.push({ type: "push", slot: msg.slot })
        }
        return
      }
      case "display_clear": {
        for (const inflight of this.inflight.values()) {
          inflight.display.push({ type: "clear", slot_id: msg.slot_id })
        }
        return
      }
      case "complete": {
        const inflight = this.inflight.get(msg.id)
        if (inflight) {
          inflight.resolveOutputs(msg.outputs)
          inflight.resolveMessage(msg.message)
          inflight.events.close()
          inflight.display.close()
          this.inflight.delete(msg.id)
        }
        return
      }
      case "error": {
        const inflight = this.inflight.get(msg.id)
        if (inflight) {
          const err = Object.assign(new Error(msg.error.message), { code: msg.error.code })
          inflight.rejectMessage(err)
          inflight.rejectOutputs(err)
          inflight.events.close()
          inflight.display.close()
          this.inflight.delete(msg.id)
        }
        return
      }
      case "pong":
        return
    }
  }
}

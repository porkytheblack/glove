import type { FileRef } from "glovebox/protocol"

/**
 * Client-side storage helpers. Symmetric to the server: the client uploads
 * inputs, the server uploads outputs. v1 only ships the two adapters that
 * don't need extra runtime services: inline (for small payloads) and url
 * (for caller-supplied URLs).
 */

export interface ClientStorage {
  /** Wrap raw bytes into a FileRef the server can read. */
  put(name: string, mime: string, bytes: Uint8Array): Promise<FileRef>
  /** Read a FileRef received from the server back into bytes. */
  get(ref: FileRef, opts?: { bearer?: string }): Promise<Uint8Array>
}

export interface DefaultClientStorageOptions {
  /** Inline below this many bytes; throws above. Default: no upper bound. */
  inlineMaxBytes?: number
}

export class DefaultClientStorage implements ClientStorage {
  constructor(private readonly opts: DefaultClientStorageOptions = {}) {}

  async put(name: string, mime: string, bytes: Uint8Array): Promise<FileRef> {
    if (this.opts.inlineMaxBytes !== undefined && bytes.length > this.opts.inlineMaxBytes) {
      throw new Error(
        `File ${name} (${bytes.length} bytes) exceeds inlineMaxBytes (${this.opts.inlineMaxBytes}); ` +
          `provide a custom ClientStorage that uploads to S3 or another backend`,
      )
    }
    return {
      kind: "inline",
      name,
      mime,
      data: bytesToBase64(bytes),
    }
  }

  async get(ref: FileRef, opts?: { bearer?: string }): Promise<Uint8Array> {
    if (ref.kind === "inline") return base64ToBytes(ref.data)
    if (ref.kind === "url" || ref.kind === "server") {
      const headers: Record<string, string> = ref.kind === "url" && ref.headers ? { ...ref.headers } : {}
      if (ref.kind === "server" && opts?.bearer) {
        headers["Authorization"] = `Bearer ${opts.bearer}`
      }
      const res = await fetch(ref.url, { headers })
      if (!res.ok) throw new Error(`Failed to fetch ${ref.url}: ${res.status} ${res.statusText}`)
      return new Uint8Array(await res.arrayBuffer())
    }
    throw new Error(`DefaultClientStorage cannot get ref of kind ${ref.kind}; pass a custom ClientStorage`)
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64")
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s)
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"))
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

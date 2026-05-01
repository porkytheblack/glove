import type { FileRef } from "glovebox-core/protocol"

import type { FileMeta, StorageAdapter } from "./index"

/**
 * URL adapter — used for inputs that arrive as a URL the server can fetch.
 * Has no `put` (the server does not invent URLs).
 */
export class UrlStorage implements StorageAdapter {
  readonly name = "url"

  async put(_meta: FileMeta, _bytes: Uint8Array): Promise<FileRef> {
    throw new Error("UrlStorage cannot put files; use it for URL-based inputs only")
  }

  async get(ref: FileRef): Promise<Uint8Array> {
    if (ref.kind !== "url") {
      throw new Error(`UrlStorage cannot get ref of kind ${ref.kind}`)
    }
    const res = await fetch(ref.url, { headers: ref.headers })
    if (!res.ok) {
      throw new Error(`Failed to fetch ${ref.url}: ${res.status} ${res.statusText}`)
    }
    const buf = await res.arrayBuffer()
    return new Uint8Array(buf)
  }
}

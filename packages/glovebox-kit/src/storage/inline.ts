import type { FileRef } from "glovebox/protocol"

import type { FileMeta, StorageAdapter } from "./index"

export class InlineStorage implements StorageAdapter {
  readonly name = "inline"

  async put(meta: FileMeta, bytes: Uint8Array): Promise<FileRef> {
    return {
      kind: "inline",
      name: meta.name,
      mime: meta.mime,
      data: Buffer.from(bytes).toString("base64"),
    }
  }

  async get(ref: FileRef): Promise<Uint8Array> {
    if (ref.kind !== "inline") {
      throw new Error(`InlineStorage cannot get ref of kind ${ref.kind}`)
    }
    return new Uint8Array(Buffer.from(ref.data, "base64"))
  }
}

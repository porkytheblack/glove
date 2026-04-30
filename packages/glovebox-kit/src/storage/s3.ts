import type { FileRef } from "glovebox/protocol"

import type { FileMeta, StorageAdapter } from "./index"

/**
 * Lightweight S3 adapter. Avoids hard-depending on `@aws-sdk/client-s3` so
 * we don't bloat the runtime image; users who actually want S3 should pass
 * an upload/download function from their own codebase.
 *
 * v1 ships as a "deferred" adapter — no concrete implementation. The kit
 * will throw a clear error if a policy targets `s3` without a registered
 * implementation.
 */
export interface S3AdapterOptions {
  bucket: string
  region?: string
  prefix?: string
  /** Required: caller-provided upload function. */
  uploadObject: (params: { bucket: string; key: string; body: Uint8Array; contentType: string }) => Promise<void>
  /** Required: caller-provided download function. */
  downloadObject: (params: { bucket: string; key: string }) => Promise<Uint8Array>
}

export class S3Storage implements StorageAdapter {
  readonly name = "s3"
  constructor(private readonly opts: S3AdapterOptions) {}

  async put(meta: FileMeta, bytes: Uint8Array): Promise<FileRef> {
    const prefix = this.opts.prefix ? this.opts.prefix.replace(/^\/|\/$/g, "") + "/" : ""
    const key = `${prefix}${meta.requestId}/${meta.name}`
    await this.opts.uploadObject({
      bucket: this.opts.bucket,
      key,
      body: bytes,
      contentType: meta.mime,
    })
    return {
      kind: "s3",
      name: meta.name,
      mime: meta.mime,
      bucket: this.opts.bucket,
      key,
      region: this.opts.region,
    }
  }

  async get(ref: FileRef): Promise<Uint8Array> {
    if (ref.kind !== "s3") {
      throw new Error(`S3Storage cannot get ref of kind ${ref.kind}`)
    }
    return this.opts.downloadObject({ bucket: ref.bucket, key: ref.key })
  }
}

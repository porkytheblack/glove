import type { FileRef, StoragePolicyEncoded } from "glovebox/protocol"

export interface FileMeta {
  name: string
  mime: string
  size: number
  /** Identifier for the request that owns the file (for sweepers and TTLs). */
  requestId: string
}

/**
 * Minimal storage interface. Servers and clients both implement compatible
 * adapters: server's `put` produces a FileRef the client can `get`, and vice
 * versa.
 */
export interface StorageAdapter {
  readonly name: string
  put(meta: FileMeta, bytes: Uint8Array): Promise<FileRef>
  get(ref: FileRef): Promise<Uint8Array>
  /** Optional cleanup of files associated with a request. */
  release?(requestId: string): Promise<void>
}

export interface PolicyContext {
  size: number
}

export function parseSize(s: string | undefined): number | undefined {
  if (!s) return undefined
  const m = /^([\d.]+)\s*(B|KB|MB|GB)?$/i.exec(s.trim())
  if (!m) return undefined
  const n = Number(m[1])
  const unit = (m[2] ?? "B").toUpperCase()
  switch (unit) {
    case "B":
      return n
    case "KB":
      return n * 1024
    case "MB":
      return n * 1024 * 1024
    case "GB":
      return n * 1024 * 1024 * 1024
  }
  return undefined
}

/**
 * Pick the first matching adapter for a given size, applying earlier rules
 * before later ones. The policy is the encoded shape produced by `composite`.
 */
export function pickAdapter(
  policy: StoragePolicyEncoded,
  context: PolicyContext,
  registry: Record<string, StorageAdapter>,
): StorageAdapter {
  let fallback: StorageAdapter | undefined
  for (const r of policy.rules) {
    const adapter = registry[r.use.adapter]
    if (!adapter) continue
    if (r.when.default) {
      if (!fallback) fallback = adapter
      continue
    }
    if (r.when.always) return adapter
    const above = parseSize(r.when.sizeAbove)
    const below = parseSize(r.when.sizeBelow)
    if (above !== undefined && context.size <= above) continue
    if (below !== undefined && context.size >= below) continue
    return adapter
  }
  if (fallback) return fallback
  throw new Error("No storage adapter matched policy and no default rule registered")
}

/**
 * Validate an outputs policy at boot: every referenced adapter must be
 * registered and must implement `put` (not just `get`). Throws on the first
 * problem so the container fails fast.
 */
export function validateOutputsPolicy(
  policy: StoragePolicyEncoded,
  registry: Record<string, StorageAdapter>,
): void {
  if (!policy.rules.length) {
    throw new Error("Outputs policy has no rules")
  }
  let hasTerminal = false
  for (const rule of policy.rules) {
    const adapter = registry[rule.use.adapter]
    if (!adapter) {
      throw new Error(`Outputs policy references unregistered adapter: ${rule.use.adapter}`)
    }
    // url is a get-only adapter — outputs must be writable.
    if (adapter.name === "url") {
      throw new Error(`Outputs policy may not target adapter "url" — it is read-only`)
    }
    if (rule.when.always || rule.when.default) hasTerminal = true
  }
  if (!hasTerminal) {
    throw new Error("Outputs policy must include a terminal rule (always: true or default: true)")
  }
}


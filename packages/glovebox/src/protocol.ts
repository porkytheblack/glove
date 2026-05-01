/**
 * Wire protocol shared by glovebox, glovebox-kit, and glovebox-client.
 *
 * One WebSocket per client session. Authenticated on upgrade with
 * `Authorization: Bearer <key>`. Multiple prompts multiplexed by `id`.
 */

// ─── FileRef ──────────────────────────────────────────────────────────────────

export type FileRefInline = {
  kind: "inline"
  name: string
  mime: string
  /** base64-encoded bytes */
  data: string
}

export type FileRefUrl = {
  kind: "url"
  name: string
  mime?: string
  url: string
  headers?: Record<string, string>
}

export type FileRefServer = {
  kind: "server"
  name: string
  mime: string
  size: number
  id: string
  url: string
}

export type FileRefS3 = {
  kind: "s3"
  name: string
  mime?: string
  bucket: string
  key: string
  region?: string
}

export type FileRefGcs = {
  kind: "gcs"
  name: string
  mime?: string
  bucket: string
  object: string
}

export type FileRef =
  | FileRefInline
  | FileRefUrl
  | FileRefServer
  | FileRefS3
  | FileRefGcs

// ─── Subscriber events (mirrors glove-core's SubscriberEvent 1:1) ────────────

export type SubscriberEventType =
  | "text_delta"
  | "tool_use"
  | "model_response"
  | "model_response_complete"
  | "tool_use_result"
  | "compaction_start"
  | "compaction_end"

// ─── Display slots (mirrors glove-core's Slot) ───────────────────────────────

export interface WireSlot<I = unknown> {
  id: string
  renderer: string
  input: I
}

// ─── Client → Server ──────────────────────────────────────────────────────────

export type ClientPromptMessage = {
  type: "prompt"
  id: string
  text: string
  inputs?: Record<string, FileRef>
  /** Optional per-request override for output storage policy. */
  outputs_policy?: OutputsPolicyOverride
}

export type ClientAbortMessage = {
  type: "abort"
  id: string
}

export type ClientDisplayResolveMessage = {
  type: "display_resolve"
  slot_id: string
  value: unknown
}

export type ClientDisplayRejectMessage = {
  type: "display_reject"
  slot_id: string
  error: unknown
}

export type ClientPingMessage = {
  type: "ping"
  ts: number
}

export type ClientMessage =
  | ClientPromptMessage
  | ClientAbortMessage
  | ClientDisplayResolveMessage
  | ClientDisplayRejectMessage
  | ClientPingMessage

// ─── Server → Client ──────────────────────────────────────────────────────────

export type ServerEventMessage = {
  type: "event"
  id: string
  event_type: SubscriberEventType
  data: unknown
}

export type ServerDisplayPushMessage = {
  type: "display_push"
  slot: WireSlot
}

export type ServerDisplayClearMessage = {
  type: "display_clear"
  slot_id: string
}

export type ServerCompleteMessage = {
  type: "complete"
  id: string
  message: string
  outputs: Record<string, FileRef>
}

export type ServerErrorMessage = {
  type: "error"
  id: string
  error: { code: string; message: string }
}

export type ServerPongMessage = {
  type: "pong"
  ts: number
}

export type ServerMessage =
  | ServerEventMessage
  | ServerDisplayPushMessage
  | ServerDisplayClearMessage
  | ServerCompleteMessage
  | ServerErrorMessage
  | ServerPongMessage

// ─── Per-request output policy override ──────────────────────────────────────

export type OutputsPolicyOverride = {
  /** Force inline below this size. */
  inline_below?: string
  /** Direct uploads to this S3 bucket. Caller must trust server with creds. */
  s3?: { bucket: string; region?: string; prefix?: string }
  /** Time-to-live for the local server adapter. */
  server_ttl?: string
}

// ─── Manifest (glovebox.json) ────────────────────────────────────────────────

export interface ManifestEnvVar {
  required: boolean
  secret?: boolean
  default?: string
  description?: string
}

export interface Manifest {
  name: string
  version: string
  base: string
  fs: Record<string, { path: string; writable: boolean }>
  env: Record<string, ManifestEnvVar>
  limits?: {
    cpu?: string
    memory?: string
    timeout?: string
  }
  /** SHA-256 prefix of the auth key (8 chars + ... + 4 chars formatting on display). */
  key_fingerprint: string
  storage_policy: {
    inputs: StoragePolicyEncoded
    outputs: StoragePolicyEncoded
  }
  packages: {
    apt?: string[]
    pip?: string[]
    npm?: string[]
  }
  /** Glovebox protocol version. */
  protocol_version: 1
}

/** Wire-encoded storage policy. Adapters are referenced by name. */
export type StoragePolicyEncoded = {
  rules: Array<{
    use: { adapter: string; options?: Record<string, unknown> }
    when: {
      sizeAbove?: string
      sizeBelow?: string
      always?: boolean
      default?: boolean
    }
  }>
}

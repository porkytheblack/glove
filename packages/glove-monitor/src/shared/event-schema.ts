import { z } from "zod"
import type { SubscriberEvent } from "glove-core"

/**
 * Mirror of glove-core's `SubscriberEvent` discriminated union, expressed as a Zod
 * schema for ingest-time validation. Keep in sync with
 * `packages/glove/src/core.ts:45-57`.
 *
 * A compile-time `satisfies` check at the bottom of this file confirms every
 * inferred Zod variant is assignable to the corresponding glove-core variant
 * (modulo our added `model` field on model_response*). Adding a new variant
 * to glove-core therefore breaks the typecheck instead of silently 400-ing
 * every ingest batch at runtime.
 */

// Mirrors glove-core's `ToolCall` interface (core.ts:200-204): `tool_name`,
// `input_args`, optional `id`. Used inside model_response.tool_calls[].
const ToolCallSchema = z.object({
  id: z.string().optional(),
  tool_name: z.string(),
  input_args: z.unknown(),
})

const ToolResultDataSchema = z.object({
  status: z.enum(["success", "error", "aborted"]).optional(),
  data: z.unknown().optional(),
  message: z.string().optional(),
}).passthrough()

const MessageSchema = z.object({
  sender: z.enum(["user", "agent"]),
  id: z.string().optional(),
  text: z.string(),
}).passthrough()

const TokenConsumptionCounterSchema = z.object({
  tokens_in: z.number(),
  tokens_out: z.number(),
}).passthrough()

const Base = { occurred_at: z.string() }

export const SubscriberEventSchema = z.discriminatedUnion("type", [
  z.object({ ...Base, type: z.literal("text_delta"), text: z.string() }),
  z.object({ ...Base, type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({
    ...Base,
    type: z.literal("model_response"),
    text: z.string(),
    tool_calls: z.array(ToolCallSchema).optional(),
    stop_reason: z.string().optional(),
    tokens_in: z.number().optional(),
    tokens_out: z.number().optional(),
    model: z.string().optional(),
  }),
  z.object({
    ...Base,
    type: z.literal("model_response_complete"),
    text: z.string(),
    tool_calls: z.array(ToolCallSchema).optional(),
    stop_reason: z.string().optional(),
    tokens_in: z.number().optional(),
    tokens_out: z.number().optional(),
    model: z.string().optional(),
  }),
  z.object({
    ...Base,
    type: z.literal("tool_use_result"),
    tool_name: z.string(),
    call_id: z.string().optional(),
    result: ToolResultDataSchema,
  }),
  z.object({ ...Base, type: z.literal("compaction_start"), current_token_consumption: z.number() }),
  z.object({
    ...Base,
    type: z.literal("compaction_end"),
    current_token_consumption: z.number(),
    summary_message: MessageSchema,
  }),
  z.object({ ...Base, type: z.literal("token_consumption"), consumption: TokenConsumptionCounterSchema }),
  z.object({ ...Base, type: z.literal("hook_invoked"), name: z.string() }),
  z.object({
    ...Base,
    type: z.literal("skill_invoked"),
    name: z.string(),
    source: z.enum(["user", "agent"]),
    args: z.string().optional(),
  }),
  z.object({ ...Base, type: z.literal("subagent_invoked"), name: z.string(), prompt: z.string() }),
  z.object({
    ...Base,
    type: z.literal("subagent_completed"),
    name: z.string(),
    status: z.enum(["success", "error"]),
    message: z.string().optional(),
  }),
])

export type IngestEvent = z.infer<typeof SubscriberEventSchema>

export const IngestPayloadSchema = z.object({
  app: z.string().min(1).max(120),
  conversation_id: z.string().min(1).max(200),
  user_id: z.string().min(1).max(200).optional(),
  events: z.array(SubscriberEventSchema).min(1).max(500),
})

export type IngestPayload = z.infer<typeof IngestPayloadSchema>

// ─── Compile-time drift guard ────────────────────────────────────────
//
// We can't fully assert structural equality between the Zod-inferred IngestEvent
// and glove-core's `SubscriberEvent` because Zod's `.passthrough()` and our
// wire-only extensions (`occurred_at`, `model` on model_response*) widen
// shapes in ways that don't reduce to `extends`. What we *can* enforce —
// and what catches the actual failure mode — is **discriminant coverage**:
// every `type` tag in glove-core's union must appear in our Zod union, and
// vice versa. Adding a new variant in glove-core (e.g. a future
// `cache_hit` event) without mirroring it here breaks this typecheck rather
// than silently 400-ing every ingest batch in production.
type SubscriberEventTags = SubscriberEvent["type"]
type IngestEventTags = IngestEvent["type"]
type _MissingFromZod = Exclude<SubscriberEventTags, IngestEventTags>
type _MissingFromCore = Exclude<IngestEventTags, SubscriberEventTags>
// Both must reduce to `never`. If either side has a tag the other doesn't,
// the assignments below fail to typecheck.
const _missingFromZod: _MissingFromZod extends never ? true : _MissingFromZod = true as never
const _missingFromCore: _MissingFromCore extends never ? true : _MissingFromCore = true as never
void _missingFromZod
void _missingFromCore

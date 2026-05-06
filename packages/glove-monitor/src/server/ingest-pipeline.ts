import crypto from "node:crypto"
import type {
  Conversation,
  EventRecord,
  MonitorStorageAdapter,
  ToolCallRecord,
} from "../adapters/types.js"
import type { IngestEvent, IngestPayload } from "../shared/event-schema.js"
import { computeCostMicros, type ModelRate } from "../pricing/rates.js"
import type { SSEHub } from "./sse.js"
import type { WebSocketHub } from "./ws.js"

export interface IngestContext {
  adapter: MonitorStorageAdapter
  sseHub: SSEHub
  wsHub: WebSocketHub
  pricingOverrides?: Record<string, ModelRate>
}

export interface IngestResolved {
  projectId: string
  clientId: string
}

export async function ingestPayload(
  ctx: IngestContext,
  resolved: IngestResolved,
  payload: IngestPayload,
): Promise<{ accepted: number }> {
  const { projectId, clientId } = resolved
  const { app, conversation_id, user_id, events } = payload
  const subject = user_id ?? clientId

  const conversationPk = `${projectId}:${conversation_id}`
  const nowIso = new Date().toISOString()

  // Ensure conversation row exists
  let conversation = await ctx.adapter.getConversation(conversationPk)
  if (!conversation) {
    const seed: Conversation = {
      id: conversationPk,
      projectId,
      appName: app,
      conversationId: conversation_id,
      subject,
      userId: user_id ?? null,
      clientId,
      status: "active",
      startedAt: nowIso,
      lastEventAt: nowIso,
      messageCount: 0,
      toolCallCount: 0,
      errorCount: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalCostMicros: 0,
      modelsUsed: [],
    }
    await ctx.adapter.upsertConversation(seed)
    conversation = seed
  }

  // Touch the app namespace
  await ctx.adapter.upsertApp({
    projectId,
    name: app,
    firstSeen: conversation.startedAt,
    lastSeen: nowIso,
  })

  let accepted = 0
  for (const event of events) {
    // Each event's writes (events row + optional tool_calls row + conversation
    // aggregate update) are committed atomically. Without this, a partial
    // failure leaves the conversation totals out of sync with the event log.
    await ctx.adapter.withTransaction(async () => {
      await processEvent(ctx, {
        projectId,
        clientId,
        subject,
        userId: user_id ?? null,
        appName: app,
        conversationId: conversation_id,
        conversationPk,
        ingestedAt: nowIso,
      }, event)
    })
    accepted++
  }

  return { accepted }
}

interface ProcessCtx {
  projectId: string
  clientId: string
  subject: string
  userId: string | null
  appName: string
  conversationId: string
  conversationPk: string
  ingestedAt: string
}

async function processEvent(
  ctx: IngestContext,
  pctx: ProcessCtx,
  event: IngestEvent,
): Promise<void> {
  const { adapter, sseHub, wsHub, pricingOverrides } = ctx
  const eventId = crypto.randomUUID()

  // Extract model + tokens + cost where applicable
  let model: string | null = null
  let tokensIn: number | null = null
  let tokensOut: number | null = null
  let costMicros: number | null = null
  let latencyMs: number | null = null

  if (event.type === "model_response_complete" || event.type === "model_response") {
    // Normalize model name once at ingest. Without this, `Claude-Opus-4-7`
    // and `claude-opus-4-7` count as two separate models in aggregates and
    // miss their pricing-rate lookup.
    const rawModel = event.model
    model = typeof rawModel === "string" && rawModel.length > 0
      ? rawModel.trim().toLowerCase()
      : null
    tokensIn = event.tokens_in ?? null
    tokensOut = event.tokens_out ?? null
    if (model) {
      // Apply DB overrides first, then in-memory overrides, then defaults via computeCostMicros.
      const dbRate = await adapter.getPricingRate(model)
      const overrides: Record<string, ModelRate> = { ...(pricingOverrides ?? {}) }
      if (dbRate) {
        overrides[model] = {
          input_per_1k_micros: dbRate.inputPer1kMicros,
          output_per_1k_micros: dbRate.outputPer1kMicros,
        }
      }
      costMicros = computeCostMicros(model, tokensIn, tokensOut, overrides)
    }
  } else if (event.type === "token_consumption") {
    tokensIn = event.consumption.tokens_in
    tokensOut = event.consumption.tokens_out
  }

  if (event.type === "tool_use_result") {
    // Pair with the most recent matching tool_use to compute latency.
    const lastUse = await adapter.findLastToolUse(
      pctx.conversationPk,
      event.tool_name,
      event.call_id ?? null,
    )
    if (lastUse) {
      const start = Date.parse(lastUse.occurredAt)
      const end = Date.parse(event.occurred_at)
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        latencyMs = end - start
      }
    }
  }

  // Persist event row
  const eventRow: EventRecord = {
    id: eventId,
    conversationPk: pctx.conversationPk,
    projectId: pctx.projectId,
    appName: pctx.appName,
    conversationId: pctx.conversationId,
    subject: pctx.subject,
    userId: pctx.userId,
    clientId: pctx.clientId,
    type: event.type,
    payload: stripBase(event),
    model,
    tokensIn,
    tokensOut,
    costMicros,
    latencyMs,
    occurredAt: event.occurred_at,
    ingestedAt: pctx.ingestedAt,
  }
  await adapter.insertEvent(eventRow)

  // Tool-call denorm for fast aggregates
  if (event.type === "tool_use_result") {
    const status: ToolCallRecord["status"] =
      event.result.status === "error" ? "error" :
      event.result.status === "aborted" ? "aborted" : "success"
    const toolCall: ToolCallRecord = {
      id: crypto.randomUUID(),
      eventId,
      conversationPk: pctx.conversationPk,
      projectId: pctx.projectId,
      appName: pctx.appName,
      toolName: event.tool_name,
      status,
      startedAt: event.occurred_at, // best-effort; could subtract latencyMs
      endedAt: event.occurred_at,
      latencyMs,
      errorMessage: status === "error" ? (event.result.message ?? null) : null,
    }
    await adapter.insertToolCall(toolCall)
  }

  // Conversation aggregate updates
  const aggregate: Parameters<MonitorStorageAdapter["updateConversationAggregates"]>[1] = {
    lastEventAt: event.occurred_at,
  }
  if (event.type === "model_response_complete") {
    aggregate.messageCountDelta = 1
    // Use != null so legitimate zero values (cached/free responses) are still
    // recorded rather than dropped by truthy-checks.
    if (tokensIn != null) aggregate.tokensInDelta = tokensIn
    if (tokensOut != null) aggregate.tokensOutDelta = tokensOut
    if (costMicros != null) aggregate.costMicrosDelta = costMicros
    if (model) aggregate.modelsUsed = [model]
  }
  // `token_consumption` events are NOT folded into the conversation aggregate
  // here. glove-core's Observer fires `token_consumption` after every turn in
  // addition to the model adapter's `model_response_complete`, so counting
  // both would double-count regular turns. This means tokens consumed during
  // a compaction pass (which emits `token_consumption` but not
  // `model_response_complete` to the outer subscriber) are not reflected in
  // the conversation total — a known limitation. Per-event tokens for
  // compaction are still stored on the events row for inspection.
  if (event.type === "tool_use_result") {
    aggregate.toolCallCountDelta = 1
    if (event.result.status === "error") aggregate.errorCountDelta = 1
  }
  await adapter.updateConversationAggregates(pctx.conversationPk, aggregate)

  // Broadcast to dashboard / SSE consumers
  const broadcastPayload = {
    id: eventId,
    type: event.type,
    conversation_id: pctx.conversationId,
    conversation_pk: pctx.conversationPk,
    app: pctx.appName,
    subject: pctx.subject,
    user_id: pctx.userId,
    client_id: pctx.clientId,
    occurred_at: event.occurred_at,
    ingested_at: pctx.ingestedAt,
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_micros: costMicros,
    latency_ms: latencyMs,
    payload: stripBase(event),
  }
  sseHub.broadcast({ projectId: pctx.projectId, event: `event:${event.type}`, data: broadcastPayload })
  wsHub.broadcast({ projectId: pctx.projectId, event: `event:${event.type}`, data: broadcastPayload })
}

function stripBase<T extends { occurred_at: string }>(event: T): Omit<T, "occurred_at"> {
  const { occurred_at: _o, ...rest } = event
  return rest
}

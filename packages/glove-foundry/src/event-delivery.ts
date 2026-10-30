import { createHash } from "node:crypto";
import type { AgentEvent } from "glove-core";
import { z } from "zod";
import type { FoundryConversationDelivery } from "./delegation.js";

/** A stable address. Events never guess which of an agent's conversations is active. */
export interface FoundryEventTarget {
  readonly agentId: string;
  readonly conversationId: string;
}

export interface FoundryEventPolicy {
  /** While busy, join at the next event boundary. While idle, wake or wait for a turn. */
  readonly whenIdle?: "wake" | "defer";
  /** A deferred event wakes after this delay; omission means wait for the next turn. */
  readonly deferTimeoutMs?: number;
}

export interface FoundryMessageOptions extends FoundryEventPolicy {
  /** Omit to address the worker's stable default conversation. */
  readonly conversationId?: string;
  /** Stable caller-provided id for retries. Scoped to the addressed conversation. */
  readonly id?: string;
  readonly expiresAt?: string;
}

export const eventPolicySchema = z.object({
  whenIdle: z.enum(["wake", "defer"]).optional(),
  deferTimeoutMs: z.number().int().nonnegative().max(2_147_483_647).optional(),
});
export const messageOptionsSchema = eventPolicySchema.extend({
  conversationId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});
export const foundryEventSchema = z.object({
  id: z.string().trim().min(1), source: z.string().trim().min(1), kind: z.string().optional(),
  content: z.union([z.string().refine((value) => value.trim().length > 0), z.array(z.object({
    type: z.enum(["text", "image", "video", "document"]), text: z.string().optional(), name: z.string().optional(),
    source: z.object({ type: z.enum(["base64", "url"]), media_type: z.string(), data: z.string().optional(), url: z.string().optional() }).optional(),
  })).min(1)]),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Adapter-backed outbox/inflight/receipt record; completed records retain deduplication ids. */
export interface FoundryEventRecord {
  readonly id: string;
  readonly target: FoundryEventTarget;
  readonly definitionId: string;
  readonly workspaceId: string;
  readonly event: AgentEvent;
  readonly policy: FoundryEventPolicy;
  readonly delivery: FoundryConversationDelivery;
  readonly status: "pending" | "acknowledged" | "expired";
  readonly runId?: string;
  readonly createdAt: string;
}

export function eventRecordId(target: FoundryEventTarget, eventId: string): string {
  return `event_${createHash("sha256").update(JSON.stringify([target.agentId, target.conversationId, eventId])).digest("hex")}`;
}

export function eventDue(record: FoundryEventRecord, now = Date.now()): boolean {
  return record.policy.whenIdle !== "defer" || (record.policy.deferTimeoutMs !== undefined
    && now >= Date.parse(record.createdAt) + record.policy.deferTimeoutMs);
}

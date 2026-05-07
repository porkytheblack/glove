import { z } from "zod";
import type { Provenance } from "../core/provenance";
import { NodeFilterSchema, type NodeFilter } from "../entity/query";

/** Wall-clock instant (ISO 8601) or a duration interval. */
export type EpisodeTime = string | { start: string; end: string };

export const EpisodeTimeSchema: z.ZodType<EpisodeTime> = z.union([
  z.string().min(1),
  z.object({ start: z.string().min(1), end: z.string().min(1) }),
]);

export type EpisodeEmbeddingStatus = "missing" | "fresh" | "stale";

/** Reference into the entity graph. Stored as plain strings — adapters do not validate that the ID exists. */
export interface EpisodeParticipant {
  entityId: string;
  role?: string;
}

export const EpisodeParticipantSchema: z.ZodType<EpisodeParticipant> = z.object({
  entityId: z.string().min(1),
  role: z.string().optional(),
});

export interface Episode {
  id: string;
  /** Required: ISO 8601 instant, or interval for episodes with duration. */
  occurredAt: EpisodeTime;
  /** Natural-language summary — the primary searchable content. */
  content: string;
  /** Registered kind name. Required. */
  kind: string;
  participants: EpisodeParticipant[];
  /** Episode-specific structured data, validated against the kind's `propertiesSchema`. */
  properties?: Record<string, unknown>;
  /** Embedding lifecycle for semantic search. */
  embeddingStatus: EpisodeEmbeddingStatus;
  createdAt: string;
  updatedAt: string;
  provenance: Provenance[];
}

/** Body of a `recordEpisode` call — adapter fills in `id`, timestamps, provenance, embeddingStatus. */
export type EpisodeWriteInput = Omit<
  Episode,
  "id" | "createdAt" | "updatedAt" | "provenance" | "embeddingStatus"
>;

export interface EpisodeQuerySpec {
  where?: {
    kind?: string | string[];
    /** Matches if any participant ID is in the set. */
    participantIds?: string[];
    /** Reuses the entity DSL filter ops applied to the episode's `properties`. */
    properties?: NodeFilter;
  };
  timeRange?: { start?: string; end?: string };
  orderBy?:
    | "occurredAt:asc"
    | "occurredAt:desc"
    | "createdAt:asc"
    | "createdAt:desc";
  limit?: number;
  offset?: number;
}

export const EpisodeQuerySpecSchema: z.ZodType<EpisodeQuerySpec> = z.object({
  where: z
    .object({
      kind: z.union([z.string(), z.array(z.string())]).optional(),
      participantIds: z.array(z.string()).optional(),
      properties: NodeFilterSchema.optional(),
    })
    .optional(),
  timeRange: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .optional(),
  orderBy: z
    .enum(["occurredAt:asc", "occurredAt:desc", "createdAt:asc", "createdAt:desc"])
    .optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

export interface EpisodeListOpts {
  limit?: number;
  offset?: number;
  orderBy?: "occurredAt:asc" | "occurredAt:desc";
  kind?: string | string[];
}

export const EpisodeListOptsSchema: z.ZodType<EpisodeListOpts> = z.object({
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  orderBy: z.enum(["occurredAt:asc", "occurredAt:desc"]).optional(),
  kind: z.union([z.string(), z.array(z.string())]).optional(),
});

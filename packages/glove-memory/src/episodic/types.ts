import type { Provenance } from "../core/provenance";

/**
 * Timeline-bound, append-only memory for things that happened. Don finished
 * the Q3 presentation; Don and Dennis discussed the regulatory licensing
 * approach yesterday. Episodes are events, not entities — they don't recur,
 * they don't merge, they just accumulate. Time is a first-class field;
 * content is the primary search surface.
 */
export interface Episode {
  id: string;
  /** ISO 8601 instant, or interval for episodes with duration. Required. */
  occurredAt: string | { start: string; end: string };
  /** Natural-language summary — the primary searchable content. */
  content: string;
  /** Registered kind name. Required. */
  kind: string;
  /** Entity references into the graph. Decoupled — just IDs. */
  participants: Array<{ entityId: string; role?: string }>;
  /** Episode-specific structured data, validated against the kind's `propertiesSchema`. */
  properties?: Record<string, unknown>;
  /** Embedding lifecycle for semantic search. */
  embeddingStatus: "missing" | "fresh" | "stale";
  createdAt: string;
  updatedAt: string;
  provenance: Provenance[];
}

export type EpisodeInput = Omit<
  Episode,
  "id" | "createdAt" | "updatedAt" | "provenance" | "embeddingStatus"
>;

export type EpisodePatch = Partial<
  Pick<Episode, "content" | "kind" | "participants" | "properties" | "occurredAt">
>;

export interface EpisodeQuerySpec {
  where?: {
    kind?: string | string[];
    /** Matches if any participant ID is in the set. */
    participantIds?: string[];
    /** Reuses the entity-side closed operator set. */
    properties?: import("../entity/query").NodeFilter;
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

export interface EpisodeListOpts {
  limit?: number;
  offset?: number;
  orderBy?: "occurredAt:asc" | "occurredAt:desc";
  kind?: string | string[];
}

export interface SemanticSearchOpts {
  limit?: number;
  filter?: {
    participantIds?: string[];
    kind?: string | string[];
    timeRange?: { start?: string; end?: string };
  };
  /** 0 = pure semantic, 1 = pure recency. Default 0.2. */
  recencyWeight?: number;
}

export interface EpisodeSearchResult {
  episode: Episode;
  /** Blended semantic + recency score (higher is better). */
  score: number;
  /** Raw embedding distance, for debugging. */
  distance: number;
}

/** Returns the start instant of an `occurredAt` value as a Date. */
export function occurredAtStart(occurredAt: Episode["occurredAt"]): Date {
  if (typeof occurredAt === "string") return new Date(occurredAt);
  return new Date(occurredAt.start);
}

/** Returns the end instant of an `occurredAt` value as a Date (== start for instants). */
export function occurredAtEnd(occurredAt: Episode["occurredAt"]): Date {
  if (typeof occurredAt === "string") return new Date(occurredAt);
  return new Date(occurredAt.end);
}

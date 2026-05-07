import { z } from "zod";
import type { Episode } from "./types";

export interface SemanticSearchOpts {
  limit?: number;
  filter?: {
    participantIds?: string[];
    kind?: string | string[];
    timeRange?: { start?: string; end?: string };
  };
  /**
   * Recency bias: blend of semantic similarity and time decay.
   * 0 = pure semantic, 1 = pure recency. Default `0.2`.
   *
   * Pure semantic search over a long timeline returns embarrassingly old
   * episodes that happen to be perfectly worded; pure recency ignores
   * meaning. The blend is what makes episodic search actually useful.
   */
  recencyWeight?: number;
}

export const SemanticSearchOptsSchema: z.ZodType<SemanticSearchOpts> = z.object({
  limit: z.number().int().positive().optional(),
  filter: z
    .object({
      participantIds: z.array(z.string()).optional(),
      kind: z.union([z.string(), z.array(z.string())]).optional(),
      timeRange: z
        .object({
          start: z.string().optional(),
          end: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  recencyWeight: z.number().min(0).max(1).optional(),
});

export interface EpisodeSearchResult {
  episode: Episode;
  /** Blended semantic + recency score in [0, 1]. */
  score: number;
  /** Raw embedding distance (lower is closer). Useful for debugging. */
  distance: number;
}

/** Default recency weight when callers don't pass one. */
export const DEFAULT_RECENCY_WEIGHT = 0.2;

/** Cosine similarity between two equal-length vectors. Returns NaN on length mismatch. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return Number.NaN;
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    aMag += av * av;
    bMag += bv * bv;
  }
  const denom = Math.sqrt(aMag) * Math.sqrt(bMag);
  if (denom === 0) return 0;
  return dot / denom;
}

/** Cosine distance: 1 - similarity, clamped to [0, 2]. */
export function cosineDistance(a: number[], b: number[]): number {
  const sim = cosineSimilarity(a, b);
  if (Number.isNaN(sim)) return Number.NaN;
  return 1 - sim;
}

/**
 * Blend semantic distance with recency. Inputs:
 *   - `distance`: cosine distance in [0, 2] (lower is closer)
 *   - `occurredAt` / `now`: parseable ISO timestamps
 *   - `recencyWeight`: 0..1, default 0.2
 *   - `halfLifeDays`: how aggressive the decay is — older episodes degrade faster
 *
 * Semantic component is `1 - distance/2` mapped to [0, 1]. Recency component is
 * exponential decay over `halfLifeDays`. Final blended score is in [0, 1];
 * higher is better.
 */
export function blendScore(
  distance: number,
  occurredAt: string,
  now: string = new Date().toISOString(),
  recencyWeight: number = DEFAULT_RECENCY_WEIGHT,
  halfLifeDays: number = 30,
): number {
  const semantic = Math.max(0, Math.min(1, 1 - distance / 2));
  const occurredMs = Date.parse(occurredAt);
  const nowMs = Date.parse(now);
  let recency = 0;
  if (Number.isFinite(occurredMs) && Number.isFinite(nowMs) && halfLifeDays > 0) {
    const ageDays = Math.max(0, (nowMs - occurredMs) / (1000 * 60 * 60 * 24));
    recency = Math.pow(0.5, ageDays / halfLifeDays);
  }
  const w = Math.max(0, Math.min(1, recencyWeight));
  return (1 - w) * semantic + w * recency;
}

/** Resolve an Episode's `occurredAt` (instant or interval) to the start ISO timestamp. */
export function episodeStart(occurredAt: Episode["occurredAt"]): string {
  return typeof occurredAt === "string" ? occurredAt : occurredAt.start;
}

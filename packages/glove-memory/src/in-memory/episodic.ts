import type { EmbeddingAdapter } from "../core/embedding";
import { MemorySchema } from "../core/schema";
import type { Provenance } from "../core/provenance";
import {
  EpisodicMemoryError,
  MemoryNotFoundError,
  MemorySchemaError,
  MemoryWriteError,
} from "../core/errors";
import type { EpisodicMemoryAdapter } from "../episodic/adapter";
import {
  type Episode,
  type EpisodeListOpts,
  type EpisodeQuerySpec,
  type EpisodeWriteInput,
} from "../episodic/types";
import {
  blendScore,
  cosineDistance,
  DEFAULT_RECENCY_WEIGHT,
  type EpisodeSearchResult,
  episodeStart,
  type SemanticSearchOpts,
} from "../episodic/semantic";
import {
  type FilterOp,
  filterOpName,
  type NodeFilter,
} from "../entity/query";

export interface InMemoryEpisodicAdapterOptions {
  identifier?: string;
  schema: MemorySchema;
  /**
   * Optional embedding adapter. When supplied, `searchEpisodes` is enabled
   * and `supportsSemanticSearch` is true.
   */
  embedder?: EmbeddingAdapter;
}

/**
 * In-process reference implementation of `EpisodicMemoryAdapter`. Stores
 * episodes in a Map and (optionally) computes naive cosine similarity
 * over locally-stored vectors. Fine for tests; not for scale.
 */
export class InMemoryEpisodicMemoryAdapter implements EpisodicMemoryAdapter {
  identifier: string;
  schema: MemorySchema;
  supportsSemanticSearch: boolean;

  private episodes = new Map<string, Episode>();
  private vectors = new Map<string, number[]>();
  private counter = 0;
  private embedder?: EmbeddingAdapter;

  constructor(opts: InMemoryEpisodicAdapterOptions) {
    this.identifier = opts.identifier ?? `in-memory-episodic_${Date.now()}`;
    this.schema = opts.schema;
    this.embedder = opts.embedder;
    this.supportsSemanticSearch = !!opts.embedder;
  }

  // ─── Write operations ────────────────────────────────────────────────────

  async recordEpisode(
    ep: EpisodeWriteInput,
    provenance: Provenance,
  ): Promise<{ id: string }> {
    requireProvenance(provenance);
    this.schema.requireEpisodeKind(ep.kind);
    if (!ep.content || ep.content.length === 0) {
      throw new MemoryWriteError("validation_failed", "Episode content cannot be empty");
    }
    if (!ep.occurredAt) {
      throw new MemoryWriteError("validation_failed", "Episode occurredAt is required");
    }
    if (!Array.isArray(ep.participants)) {
      throw new MemoryWriteError(
        "validation_failed",
        "Episode participants must be an array (use [] for none)",
      );
    }
    let validatedProps: Record<string, unknown> | undefined;
    try {
      const v = this.schema.validateEpisodeProps(ep.kind, ep.properties);
      validatedProps = v as Record<string, unknown> | undefined;
    } catch (e) {
      if (e instanceof MemorySchemaError) {
        throw new MemoryWriteError("validation_failed", e.message, e.details);
      }
      throw e;
    }

    const id = this.nextEpisodeId();
    const now = new Date().toISOString();
    const episode: Episode = {
      id,
      occurredAt: ep.occurredAt,
      content: ep.content,
      kind: ep.kind,
      participants: ep.participants.map((p) => ({ ...p })),
      properties: validatedProps,
      embeddingStatus: "missing",
      createdAt: now,
      updatedAt: now,
      provenance: [provenance],
    };
    this.episodes.set(id, episode);
    return { id };
  }

  async getEpisode(id: string): Promise<Episode | null> {
    return this.episodes.get(id) ?? null;
  }

  async updateEpisode(
    id: string,
    patch: Partial<
      Pick<Episode, "content" | "kind" | "participants" | "properties" | "occurredAt">
    >,
    provenance: Provenance,
  ): Promise<void> {
    requireProvenance(provenance);
    const ep = this.episodes.get(id);
    if (!ep) throw new MemoryNotFoundError(`Episode ${id} not found`);

    if (patch.kind !== undefined) {
      this.schema.requireEpisodeKind(patch.kind);
      ep.kind = patch.kind;
    }
    if (patch.occurredAt !== undefined) ep.occurredAt = patch.occurredAt;
    if (patch.participants !== undefined) {
      ep.participants = patch.participants.map((p) => ({ ...p }));
    }
    if (patch.properties !== undefined) {
      try {
        const v = this.schema.validateEpisodeProps(ep.kind, patch.properties);
        ep.properties = v as Record<string, unknown> | undefined;
      } catch (e) {
        if (e instanceof MemorySchemaError) {
          throw new MemoryWriteError("validation_failed", e.message, e.details);
        }
        throw e;
      }
    }

    const contentChanged = patch.content !== undefined && patch.content !== ep.content;
    if (patch.content !== undefined) ep.content = patch.content;

    ep.updatedAt = new Date().toISOString();
    ep.provenance = [...ep.provenance, provenance];
    if (contentChanged && ep.embeddingStatus === "fresh") {
      ep.embeddingStatus = "stale";
    }
  }

  async deleteEpisode(id: string, provenance: Provenance): Promise<void> {
    requireProvenance(provenance);
    if (!this.episodes.has(id)) {
      throw new MemoryNotFoundError(`Episode ${id} not found`);
    }
    this.episodes.delete(id);
    this.vectors.delete(id);
  }

  // ─── Structured query ────────────────────────────────────────────────────

  async findEpisodes(spec: EpisodeQuerySpec): Promise<Episode[]> {
    if (spec.timeRange?.start && spec.timeRange?.end) {
      if (Date.parse(spec.timeRange.start) > Date.parse(spec.timeRange.end)) {
        throw new EpisodicMemoryError(
          "invalid_time_range",
          `timeRange.start (${spec.timeRange.start}) must be <= timeRange.end (${spec.timeRange.end})`,
        );
      }
    }
    let candidates = [...this.episodes.values()];
    candidates = candidates.filter((ep) => matchesEpisodeWhere(ep, spec.where));
    candidates = candidates.filter((ep) => matchesTimeRange(ep, spec.timeRange));

    sortEpisodes(candidates, spec.orderBy ?? "occurredAt:desc");
    return paginate(candidates, spec.limit, spec.offset);
  }

  async episodesForEntity(entityId: string, opts: EpisodeListOpts = {}): Promise<Episode[]> {
    const kindFilter = normaliseKindFilter(opts.kind);
    let candidates = [...this.episodes.values()].filter((ep) =>
      ep.participants.some((p) => p.entityId === entityId),
    );
    if (kindFilter) candidates = candidates.filter((ep) => kindFilter.has(ep.kind));
    sortEpisodes(candidates, opts.orderBy ?? "occurredAt:desc");
    return paginate(candidates, opts.limit, opts.offset);
  }

  async episodesBetween(
    start: string,
    end: string,
    opts: EpisodeListOpts = {},
  ): Promise<Episode[]> {
    if (Date.parse(start) > Date.parse(end)) {
      throw new EpisodicMemoryError(
        "invalid_time_range",
        `start (${start}) must be <= end (${end})`,
      );
    }
    const kindFilter = normaliseKindFilter(opts.kind);
    let candidates = [...this.episodes.values()].filter((ep) =>
      matchesTimeRange(ep, { start, end }),
    );
    if (kindFilter) candidates = candidates.filter((ep) => kindFilter.has(ep.kind));
    sortEpisodes(candidates, opts.orderBy ?? "occurredAt:asc");
    return paginate(candidates, opts.limit, opts.offset);
  }

  async replaceParticipantId(
    oldId: string,
    newId: string,
    provenance: Provenance,
  ): Promise<{ updated: number }> {
    requireProvenance(provenance);
    if (oldId === newId) return { updated: 0 };
    let updated = 0;
    const note = `participant ${oldId} → ${newId}`;
    for (const ep of this.episodes.values()) {
      let touched = false;
      for (const p of ep.participants) {
        if (p.entityId === oldId) {
          p.entityId = newId;
          touched = true;
        }
      }
      if (touched) {
        updated += 1;
        ep.updatedAt = new Date().toISOString();
        ep.provenance = [
          ...ep.provenance,
          {
            ...provenance,
            note: provenance.note ? `${provenance.note}; ${note}` : note,
          },
        ];
      }
    }
    return { updated };
  }

  // ─── Embedding lifecycle ─────────────────────────────────────────────────

  async findEpisodesNeedingEmbedding(
    opts: { limit?: number } = {},
  ): Promise<Array<{ id: string; content: string }>> {
    const out: Array<{ id: string; content: string }> = [];
    for (const ep of this.episodes.values()) {
      if (ep.embeddingStatus !== "missing" && ep.embeddingStatus !== "stale") continue;
      out.push({ id: ep.id, content: ep.content });
      if (opts.limit !== undefined && out.length >= opts.limit) break;
    }
    return out;
  }

  async setEmbedding(id: string, vector: number[]): Promise<void> {
    const ep = this.episodes.get(id);
    if (!ep) throw new MemoryNotFoundError(`Episode ${id} not found`);
    if (this.embedder && vector.length !== this.embedder.dimensions) {
      throw new EpisodicMemoryError(
        "embedding_unavailable",
        `Vector length ${vector.length} does not match adapter dimensions ${this.embedder.dimensions}`,
      );
    }
    this.vectors.set(id, [...vector]);
    ep.embeddingStatus = "fresh";
    ep.updatedAt = new Date().toISOString();
  }

  // ─── Semantic search ─────────────────────────────────────────────────────

  async searchEpisodes(
    query: string,
    opts: SemanticSearchOpts = {},
  ): Promise<EpisodeSearchResult[]> {
    if (!this.embedder) {
      throw new EpisodicMemoryError(
        "semantic_search_unsupported",
        "This adapter has no embedding adapter wired up; searchEpisodes is disabled.",
      );
    }
    if (opts.filter?.timeRange?.start && opts.filter?.timeRange?.end) {
      if (Date.parse(opts.filter.timeRange.start) > Date.parse(opts.filter.timeRange.end)) {
        throw new EpisodicMemoryError(
          "invalid_time_range",
          `timeRange.start must be <= timeRange.end`,
        );
      }
    }

    const [queryVec] = await this.embedder.embed([query]);
    if (!queryVec) {
      throw new EpisodicMemoryError(
        "embedding_unavailable",
        "Embedder returned no vector for the query",
      );
    }

    const kindFilter = normaliseKindFilter(opts.filter?.kind);
    const participantFilter = opts.filter?.participantIds
      ? new Set(opts.filter.participantIds)
      : null;

    const candidates: EpisodeSearchResult[] = [];
    for (const ep of this.episodes.values()) {
      if (ep.embeddingStatus !== "fresh") continue;
      const vec = this.vectors.get(ep.id);
      if (!vec) continue;
      if (kindFilter && !kindFilter.has(ep.kind)) continue;
      if (participantFilter) {
        if (!ep.participants.some((p) => participantFilter.has(p.entityId))) continue;
      }
      if (!matchesTimeRange(ep, opts.filter?.timeRange)) continue;

      const distance = cosineDistance(queryVec, vec);
      const score = blendScore(
        distance,
        episodeStart(ep.occurredAt),
        new Date().toISOString(),
        opts.recencyWeight ?? DEFAULT_RECENCY_WEIGHT,
      );
      candidates.push({ episode: ep, score, distance });
    }

    candidates.sort((a, b) => b.score - a.score);
    if (opts.limit !== undefined) return candidates.slice(0, opts.limit);
    return candidates;
  }

  private nextEpisodeId(): string {
    this.counter += 1;
    return `ep_${Date.now().toString(36)}_${this.counter}`;
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

function requireProvenance(p: Provenance | undefined): asserts p is Provenance {
  if (!p) {
    throw new MemoryWriteError(
      "provenance_required",
      "Provenance is required on every memory write",
    );
  }
  if (!p.source || !p.actor || !p.timestamp) {
    throw new MemoryWriteError(
      "provenance_required",
      "Provenance must include `source`, `actor`, and `timestamp`",
    );
  }
}

function normaliseKindFilter(kind: string | string[] | undefined): Set<string> | null {
  if (!kind) return null;
  return new Set(Array.isArray(kind) ? kind : [kind]);
}

function matchesEpisodeWhere(
  ep: Episode,
  where: EpisodeQuerySpec["where"] | undefined,
): boolean {
  if (!where) return true;
  if (where.kind) {
    const kinds = Array.isArray(where.kind) ? where.kind : [where.kind];
    if (!kinds.includes(ep.kind)) return false;
  }
  if (where.participantIds && where.participantIds.length > 0) {
    const set = new Set(where.participantIds);
    if (!ep.participants.some((p) => set.has(p.entityId))) return false;
  }
  if (where.properties) {
    if (!matchesNodeFilterOnObject(ep.properties ?? {}, where.properties)) return false;
  }
  return true;
}

function matchesTimeRange(
  ep: Episode,
  range: { start?: string; end?: string } | undefined,
): boolean {
  if (!range) return true;
  const start = episodeStart(ep.occurredAt);
  const startMs = Date.parse(start);
  if (range.start && startMs < Date.parse(range.start)) return false;
  if (range.end && startMs > Date.parse(range.end)) return false;
  return true;
}

function sortEpisodes(eps: Episode[], orderBy: string): void {
  const [fieldRaw, dir = "desc"] = orderBy.split(":");
  const field = fieldRaw as "occurredAt" | "createdAt";
  const sign = dir === "asc" ? 1 : -1;
  eps.sort((a, b) => {
    const av = field === "createdAt" ? a.createdAt : episodeStart(a.occurredAt);
    const bv = field === "createdAt" ? b.createdAt : episodeStart(b.occurredAt);
    const aMs = Date.parse(av);
    const bMs = Date.parse(bv);
    if (Number.isNaN(aMs) || Number.isNaN(bMs)) return 0;
    return sign * (aMs - bMs);
  });
}

function paginate<T>(arr: T[], limit?: number, offset?: number): T[] {
  const start = offset ?? 0;
  const end = limit !== undefined ? start + limit : undefined;
  return arr.slice(start, end);
}

/**
 * Subset of node-filter matching used for `EpisodeQuerySpec.where.properties`.
 * Reuses the entity DSL operator semantics on a flat record.
 */
function matchesNodeFilterOnObject(
  obj: Record<string, unknown>,
  filter: NodeFilter,
): boolean {
  for (const [propName, ops] of Object.entries(filter)) {
    const opList = Array.isArray(ops) ? ops : [ops];
    for (const op of opList) {
      if (!matchOp(obj[propName], op)) return false;
    }
  }
  return true;
}

function matchOp(value: unknown, op: FilterOp): boolean {
  const name = filterOpName(op);
  switch (name) {
    case "eq":
      return JSON.stringify(value) === JSON.stringify((op as { eq: unknown }).eq);
    case "neq":
      return JSON.stringify(value) !== JSON.stringify((op as { neq: unknown }).neq);
    case "in":
      return (op as { in: unknown[] }).in.some(
        (v) => JSON.stringify(v) === JSON.stringify(value),
      );
    case "not_in":
      return !(op as { not_in: unknown[] }).not_in.some(
        (v) => JSON.stringify(v) === JSON.stringify(value),
      );
    case "exists":
      return ((op as { exists: boolean }).exists) === (value !== undefined && value !== null);
    case "contains":
      return typeof value === "string" && value.includes((op as { contains: string }).contains);
    case "starts_with":
      return (
        typeof value === "string" &&
        value.startsWith((op as { starts_with: string }).starts_with)
      );
    case "ends_with":
      return (
        typeof value === "string" &&
        value.endsWith((op as { ends_with: string }).ends_with)
      );
    case "fuzzy": {
      if (typeof value !== "string") return false;
      const needle = (op as { fuzzy: string }).fuzzy.toLowerCase();
      return value.toLowerCase().includes(needle);
    }
    case "gt":
      return cmp(value, (op as { gt: number | string }).gt) > 0;
    case "gte":
      return cmp(value, (op as { gte: number | string }).gte) >= 0;
    case "lt":
      return cmp(value, (op as { lt: number | string }).lt) < 0;
    case "lte":
      return cmp(value, (op as { lte: number | string }).lte) <= 0;
    case "between": {
      const [lo, hi] = (op as { between: [unknown, unknown] }).between;
      return cmp(value, lo) >= 0 && cmp(value, hi) <= 0;
    }
    default:
      return false;
  }
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

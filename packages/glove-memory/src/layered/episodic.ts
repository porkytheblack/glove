import type { EpisodicMemoryAdapter } from "../episodic/adapter";
import type {
  Episode,
  EpisodeInput,
  EpisodeListOpts,
  EpisodePatch,
  EpisodeQuerySpec,
  EpisodeSearchResult,
  SemanticSearchOpts,
} from "../episodic/types";
import { occurredAtStart } from "../episodic/types";
import type { Provenance } from "../core/provenance";
import { MemoryLayerError } from "../core/errors";
import {
  mergeUnique,
  pushDownLimit,
  refuseWrite,
  resolveLayers,
  windowed,
  type MemoryLayer,
} from "./shared";

export type EpisodicLayer = MemoryLayer<EpisodicMemoryAdapter>;

/** An `EpisodicMemoryAdapter` assembled from strata, carrying the stack it merges. */
export interface LayeredEpisodicAdapter extends EpisodicMemoryAdapter {
  readonly layers: EpisodicLayer[];
  /** Which stratum owns an episode id, or null when nothing has it. */
  layerOf(id: string): Promise<string | null>;
}

type OrderBy = NonNullable<EpisodeQuerySpec["orderBy"]>;

function sortKey(ep: Episode, orderBy: OrderBy): number {
  const field = orderBy.startsWith("createdAt") ? new Date(ep.createdAt) : occurredAtStart(ep.occurredAt);
  return field.getTime();
}

/** Re-sorts a merged set the way the per-layer adapters sorted their own. */
function sortMerged(eps: Episode[], orderBy: OrderBy): Episode[] {
  const descending = orderBy.endsWith(":desc");
  return [...eps].sort((a, b) => {
    const delta = sortKey(a, orderBy) - sortKey(b, orderBy);
    return descending ? -delta : delta;
  });
}

/**
 * Merges several `EpisodicMemoryAdapter`s into one timeline.
 *
 * The shape that motivates it: org-wide events the agent should know about
 * but never rewrite, interleaved with the episodes it records itself. Both
 * come back from one `find` / `timeline` / `search`, in true chronological
 * order across strata — the agent doesn't know, and doesn't need to know,
 * which stratum a given episode came from.
 *
 * A merged query can't push `offset` down (the rows an earlier layer skipped
 * aren't the rows the merged view skips), so each layer is asked for
 * `limit + offset` rows, the results are merged, re-sorted on the requested
 * key, and the window is applied to the merged list.
 *
 * Writes go to the single writable stratum. `updateEpisode` / `deleteEpisode`
 * against an episode a read-only stratum owns are refused with
 * `MemoryLayerError` (`code: "layer_read_only"`). Participants may reference
 * entity ids from any stratum — episodic never validates link targets, so
 * cross-stratum participation works without special handling.
 *
 * `supportsSemanticSearch` is true when *any* stratum supports it, and
 * `searchEpisodes` queries only the strata that do; a shared corpus with a
 * built index composes with a private store that has none.
 */
export function layerEpisodic(layers: EpisodicLayer[]): LayeredEpisodicAdapter {
  const { all, writable } = resolveLayers(layers, "layerEpisodic");
  const searchable = all.filter((l) => l.adapter.supportsSemanticSearch && l.adapter.searchEpisodes);

  async function ownerOf(id: string): Promise<EpisodicLayer | null> {
    for (const layer of all) {
      if (await layer.adapter.getEpisode(id)) return layer;
    }
    return null;
  }

  async function requireWritable(id: string, operation: string): Promise<void> {
    const owner = await ownerOf(id);
    if (!owner) {
      throw new MemoryLayerError("layer_read_only", `No episode with id "${id}" in any layer.`);
    }
    if (owner.access !== "write") refuseWrite(owner.name, `Episode "${id}"`, operation);
  }

  const adapter: LayeredEpisodicAdapter = {
    identifier: `layered(${all.map((l) => l.adapter.identifier).join("+")})`,
    schema: all[0]!.adapter.schema,
    supportsSemanticSearch: searchable.length > 0,
    layers: all,

    async layerOf(id) {
      return (await ownerOf(id))?.name ?? null;
    },

    // ─── Write ────────────────────────────────────────────────────────────

    async recordEpisode(ep: EpisodeInput, provenance: Provenance) {
      return writable.adapter.recordEpisode(ep, provenance);
    },

    async updateEpisode(id: string, patch: EpisodePatch, provenance: Provenance) {
      await requireWritable(id, "updating it");
      return writable.adapter.updateEpisode(id, patch, provenance);
    },

    async deleteEpisode(id: string, provenance: Provenance) {
      await requireWritable(id, "deleting it");
      return writable.adapter.deleteEpisode(id, provenance);
    },

    // ─── Read ─────────────────────────────────────────────────────────────

    async getEpisode(id) {
      for (const layer of all) {
        const ep = await layer.adapter.getEpisode(id);
        if (ep) return ep;
      }
      return null;
    },

    async findEpisodes(spec: EpisodeQuerySpec) {
      const perLayer = { ...spec, offset: undefined, limit: pushDownLimit(spec) };
      const groups = await Promise.all(all.map((l) => l.adapter.findEpisodes(perLayer)));
      const merged = mergeUnique<Episode>(groups, (e) => e.id);
      return windowed(sortMerged(merged, spec.orderBy ?? "occurredAt:desc"), spec);
    },

    async episodesForEntity(entityId: string, opts: EpisodeListOpts = {}) {
      const perLayer = { ...opts, offset: undefined, limit: pushDownLimit(opts) };
      const groups = await Promise.all(
        all.map((l) => l.adapter.episodesForEntity(entityId, perLayer)),
      );
      const merged = mergeUnique<Episode>(groups, (e) => e.id);
      return windowed(sortMerged(merged, opts.orderBy ?? "occurredAt:desc"), opts);
    },

    async episodesBetween(start: string, end: string, opts: EpisodeListOpts = {}) {
      const perLayer = { ...opts, offset: undefined, limit: pushDownLimit(opts) };
      const groups = await Promise.all(
        all.map((l) => l.adapter.episodesBetween(start, end, perLayer)),
      );
      const merged = mergeUnique<Episode>(groups, (e) => e.id);
      return windowed(sortMerged(merged, opts.orderBy ?? "occurredAt:desc"), opts);
    },

    async replaceParticipantId(oldId: string, newId: string, provenance: Provenance) {
      // Reconciliation after an entity merge. Only the writable stratum can
      // be rewritten; a shared corpus keeps its own ids and is reconciled by
      // whoever owns it.
      return writable.adapter.replaceParticipantId(oldId, newId, provenance);
    },

    // ─── Embedding lifecycle ──────────────────────────────────────────────

    async findEpisodesNeedingEmbedding(opts: { limit?: number } = {}) {
      const groups = await Promise.all(
        all.map((l) => l.adapter.findEpisodesNeedingEmbedding(opts)),
      );
      const merged = mergeUnique(groups, (e) => e.id);
      return opts.limit === undefined ? merged : merged.slice(0, opts.limit);
    },

    async setEmbedding(id: string, vector: number[]) {
      // Indexing is the host's business, not the agent's, so it is allowed
      // against a read-only stratum — same call the shared corpus's own
      // worker would make.
      const owner = await ownerOf(id);
      if (!owner) {
        throw new MemoryLayerError("layer_read_only", `No episode with id "${id}" in any layer.`);
      }
      return owner.adapter.setEmbedding(id, vector);
    },
  };

  if (searchable.length > 0) {
    adapter.searchEpisodes = async (
      query: string,
      opts: SemanticSearchOpts = {},
    ): Promise<EpisodeSearchResult[]> => {
      const groups = await Promise.all(
        searchable.map((l) => l.adapter.searchEpisodes!(query, opts)),
      );
      const merged = mergeUnique<EpisodeSearchResult>(groups, (r) => r.episode.id);
      // Scores are comparable only if the strata rank alike. They usually
      // don't (one embedding-backed, one lexical), so this is a best-effort
      // interleave rather than a true global ranking — documented, because
      // silently presenting it as one ranking would be a lie.
      merged.sort((a, b) => b.score - a.score);
      return opts.limit === undefined ? merged : merged.slice(0, opts.limit);
    };
  }

  return adapter;
}

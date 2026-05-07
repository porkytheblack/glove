import type { Provenance } from "../core/provenance";
import type { MemorySchema } from "../core/schema";
import type {
  Episode,
  EpisodeInput,
  EpisodeListOpts,
  EpisodePatch,
  EpisodeQuerySpec,
  EpisodeSearchResult,
  SemanticSearchOpts,
} from "./types";

/**
 * Storage-agnostic contract for the episodic memory subsystem.
 *
 * **Append-only with rare updates.** Default operation is `recordEpisode`;
 * there is no merge, no identity dedup, no key-based upsert. `updateEpisode`
 * exists for legitimate cases — recording an in-progress meeting and
 * patching in the outcome later, enriching a thinly-described episode with
 * more detail — but it's the exception. If two episodes turn out to be the
 * same event captured twice, the curator deletes one rather than merging.
 *
 * **Embeddings are out-of-band.** `recordEpisode` and `updateEpisode` mark
 * the episode `embeddingStatus: "missing"` (on record) or `"stale"` (on
 * content update) and return immediately. A separate process — typically a
 * Station (https://station.dterminal.net) signal — picks them up via
 * `findEpisodesNeedingEmbedding`,
 * computes embeddings via the configured `EmbeddingAdapter`, and writes
 * vectors back via `setEmbedding`.
 *
 * **No cross-adapter cascade.** `replaceParticipantId` is provided so
 * orchestrators can reconcile episodes after an entity merge — the package
 * doesn't do this automatically.
 */
export interface EpisodicMemoryAdapter {
  identifier: string;
  schema: MemorySchema;
  /** True when the adapter supports `searchEpisodes`. Drives whether the search reader tool is registered. */
  supportsSemanticSearch: boolean;

  // ─── Write operations ─────────────────────────────────────────────────

  recordEpisode(
    ep: EpisodeInput,
    provenance: Provenance,
  ): Promise<{ id: string }>;

  getEpisode(id: string): Promise<Episode | null>;

  updateEpisode(
    id: string,
    patch: EpisodePatch,
    provenance: Provenance,
  ): Promise<void>;

  deleteEpisode(id: string, provenance: Provenance): Promise<void>;

  // ─── Structured query ─────────────────────────────────────────────────

  findEpisodes(spec: EpisodeQuerySpec): Promise<Episode[]>;

  episodesForEntity(
    entityId: string,
    opts?: EpisodeListOpts,
  ): Promise<Episode[]>;

  episodesBetween(
    start: string,
    end: string,
    opts?: EpisodeListOpts,
  ): Promise<Episode[]>;

  /**
   * Bulk participant rewrite — used by orchestrators to reconcile after an
   * entity merge. When entity `n2` is folded into `n1`, every episode that
   * referenced `n2` gets its participant ID rewritten to `n1`.
   */
  replaceParticipantId(
    oldId: string,
    newId: string,
    provenance: Provenance,
  ): Promise<{ updated: number }>;

  // ─── Embedding lifecycle ──────────────────────────────────────────────

  findEpisodesNeedingEmbedding(
    opts?: { limit?: number },
  ): Promise<Array<{ id: string; content: string }>>;

  setEmbedding(id: string, vector: number[]): Promise<void>;

  // ─── Semantic search (only callable when supportsSemanticSearch is true) ─

  searchEpisodes?(
    query: string,
    opts?: SemanticSearchOpts,
  ): Promise<EpisodeSearchResult[]>;
}

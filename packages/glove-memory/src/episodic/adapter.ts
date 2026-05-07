import type { Provenance } from "../core/provenance";
import type { MemorySchema } from "../core/schema";
import type {
  Episode,
  EpisodeListOpts,
  EpisodeQuerySpec,
  EpisodeWriteInput,
} from "./types";
import type { EpisodeSearchResult, SemanticSearchOpts } from "./semantic";

/**
 * Storage-agnostic contract for timeline-bound, append-only episodic memory.
 * Sibling to `EntityMemoryAdapter`; both bind to the same `MemorySchema`
 * but have separate stores. They integrate only at the curator layer via
 * entity IDs referenced from `Episode.participants`.
 *
 * Embeddings are not generated here. The adapter writes the episode with
 * `embeddingStatus: "missing"` (on record) or marks it `"stale"` (on
 * content update) and returns immediately. A separate process picks up
 * missing/stale episodes via `findEpisodesNeedingEmbedding`, computes
 * vectors via the configured `EmbeddingAdapter`, and writes them back via
 * `setEmbedding`. This keeps writes fast and decouples embedding cost
 * from the curator's hot path.
 *
 * Episodes with non-fresh embeddings are still findable via structured
 * query (`findEpisodes`, `episodesForEntity`, `episodesBetween`) — they
 * are just invisible to `searchEpisodes` until embedded.
 */
export interface EpisodicMemoryAdapter {
  /** Stable identifier for log correlation. */
  identifier: string;
  schema: MemorySchema;
  /**
   * True when the underlying storage backend supports vector search and an
   * `EmbeddingAdapter` has been wired up. Drives whether `searchEpisodes`
   * is registered as a tool.
   */
  supportsSemanticSearch: boolean;

  // ─── Write operations ────────────────────────────────────────────────────

  recordEpisode(
    ep: EpisodeWriteInput,
    provenance: Provenance,
  ): Promise<{ id: string }>;

  getEpisode(id: string): Promise<Episode | null>;

  updateEpisode(
    id: string,
    patch: Partial<
      Pick<Episode, "content" | "kind" | "participants" | "properties" | "occurredAt">
    >,
    provenance: Provenance,
  ): Promise<void>;

  deleteEpisode(id: string, provenance: Provenance): Promise<void>;

  // ─── Structured query ────────────────────────────────────────────────────

  findEpisodes(spec: EpisodeQuerySpec): Promise<Episode[]>;

  episodesForEntity(entityId: string, opts?: EpisodeListOpts): Promise<Episode[]>;

  episodesBetween(start: string, end: string, opts?: EpisodeListOpts): Promise<Episode[]>;

  // ─── Reconciliation primitives ───────────────────────────────────────────

  /**
   * Bulk participant rewrite. Used by orchestrators to reconcile after an
   * entity merge: when entity `n2` is merged into `n1`, the orchestrator
   * calls `replaceParticipantId("n2", "n1", prov)`. The package does NOT
   * cascade this automatically — that's an orchestrator responsibility.
   */
  replaceParticipantId(
    oldId: string,
    newId: string,
    provenance: Provenance,
  ): Promise<{ updated: number }>;

  // ─── Embedding lifecycle ─────────────────────────────────────────────────

  findEpisodesNeedingEmbedding(opts?: { limit?: number }): Promise<
    Array<{ id: string; content: string }>
  >;

  setEmbedding(id: string, vector: number[]): Promise<void>;

  // ─── Semantic search ─────────────────────────────────────────────────────

  /** Only callable when `supportsSemanticSearch` is true. */
  searchEpisodes?(query: string, opts?: SemanticSearchOpts): Promise<EpisodeSearchResult[]>;
}

import type { Provenance } from "../core/provenance";
import type { MemorySchema } from "../core/schema";
import type {
  EdgeWriteResult,
  MemoryEdge,
  MemoryNode,
  NodeWriteResult,
} from "./types";
import type { NodeFilter, QueryResult, QuerySpec } from "./query";

export interface FindNodesOptions {
  /** Use fuzzy matching on `searchableProperties` when filter ops support it. */
  fuzzy?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Storage-agnostic contract for graph-shaped entity memory. One adapter
 * instance per workspace. Storage backends (`glove-memory-sqlite`,
 * `glove-memory-postgres`) ship as separate packages; the in-memory
 * reference adapter lives at `glove-memory/in-memory`.
 *
 * Identity behaviour:
 *   - Writes match against `identityKeys` deterministically. No fuzzy on
 *     the write path.
 *   - If any identity key set matches an existing node, `addNode` returns
 *     that node's id with `created: false`.
 *   - Property merging on identity hit: missing properties on the existing
 *     node are filled in from the new write; conflicting properties are
 *     left untouched and the conflict is recorded in provenance.
 *   - Curator-side reasoning that wants fuzzy-then-merge does it
 *     explicitly: `findNodes(..., { fuzzy: true })` → `mergeNodes(keep, merge)`.
 *
 * The adapter is the only writer in production deployments — readers never
 * call mutating methods. See README "Concurrency" for the multi-writer notes.
 */
export interface EntityMemoryAdapter {
  /** Stable identifier for log correlation. */
  identifier: string;
  schema: MemorySchema;

  // ─── Node operations ─────────────────────────────────────────────────────

  addNode(
    className: string,
    props: unknown,
    provenance: Provenance,
  ): Promise<NodeWriteResult>;

  getNode(id: string): Promise<MemoryNode | null>;

  updateNode(
    id: string,
    props: Record<string, unknown>,
    provenance: Provenance,
  ): Promise<void>;

  /**
   * Fold `mergeId` into `keepId`. The `mergeId` node and any edges that
   * referenced it are rewritten to point at `keepId`. Episodic participants
   * are NOT rewritten by this primitive — orchestrators reach for
   * `EpisodicMemoryAdapter.replaceParticipantId` afterward (see Reconciliation
   * responsibilities in the README).
   */
  mergeNodes(
    keepId: string,
    mergeId: string,
    provenance: Provenance,
  ): Promise<void>;

  // ─── Edge operations ─────────────────────────────────────────────────────

  /** Edge identity is `(fromId, toId, type)` by default. Re-`connect` updates props. `multi: true` relationship defs allow duplicates. */
  connect(
    fromId: string,
    toId: string,
    relType: string,
    props: unknown | undefined,
    provenance: Provenance,
  ): Promise<EdgeWriteResult>;

  disconnect(edgeId: string, provenance: Provenance): Promise<void>;

  // ─── Query operations ────────────────────────────────────────────────────

  findNodes(
    className: string,
    where: NodeFilter,
    opts?: FindNodesOptions,
  ): Promise<MemoryNode[]>;

  /** Optional: introspect raw edges for a node. Useful for `glove_memory_get`'s one-hop neighbourhood. */
  edgesForNode?(
    nodeId: string,
    opts?: { limit?: number; types?: string[] },
  ): Promise<MemoryEdge[]>;

  query(spec: QuerySpec): Promise<QueryResult>;
}

import type { Provenance } from "../core/provenance";
import type { MemorySchema } from "../core/schema";
import type {
  EdgeWriteResult,
  MemoryNode,
  NodeWithNeighbours,
  NodeWriteResult,
} from "./types";
import type { NodeFilter, QueryResult, QuerySpec } from "./query";

/**
 * Storage-agnostic contract for the entity memory subsystem.
 *
 * Implementations are owned by storage backends — the package ships a
 * reference in-memory adapter for dev/test (`InMemoryEntityAdapter`) and
 * companion packages (`glove-memory-sqlite`, `glove-memory-postgres`) ship
 * production-shaped implementations.
 *
 * **Identity behaviour.** Writes match against `identityKeys` deterministically.
 * No fuzzy on the write path. If any identity key set matches an existing
 * node, `addNode` returns that node's id with `created: false`. Property
 * merging on identity hit: missing properties on the existing node are filled
 * from the new write; conflicting properties are left untouched and the
 * conflict is recorded in provenance. If two distinct existing nodes match
 * different identity sets in the same write, the adapter throws
 * `MemoryWriteError("identity_ambiguous")` — the orchestrator's expected
 * response is to merge first, then retry.
 *
 * **Provenance.** Required on all writes. Append-only per node and edge.
 *
 * **No cascade.** When an entity is merged or deleted, episodes that
 * reference its old ID don't update on their own. Reconciliation is the
 * orchestrator's job; the package surfaces the primitives.
 */
export interface EntityMemoryAdapter {
  identifier: string;
  schema: MemorySchema;

  // ─── Node operations ──────────────────────────────────────────────────

  /**
   * Create a node, or upsert against `identityKeys`. Returns the resolved id
   * and a `created` flag so callers can distinguish first-write from
   * dedup-into-existing.
   */
  addNode(
    className: string,
    props: unknown,
    provenance: Provenance,
  ): Promise<NodeWriteResult>;

  getNode(id: string): Promise<MemoryNode | null>;

  /**
   * Patch a node's properties. Missing keys are left untouched. Validates
   * the merged object against the class schema and throws
   * `MemoryWriteError("validation_failed")` on failure.
   */
  updateNode(
    id: string,
    props: Record<string, unknown>,
    provenance: Provenance,
  ): Promise<void>;

  /**
   * Fold `mergeId` into `keepId`. Edges incident to `mergeId` are rewritten
   * to point at `keepId`; if the rewrite would create a duplicate edge,
   * properties are merged and provenance is appended. Episodic / resource
   * cross-references are NOT cascaded — orchestrators reach for
   * `episodic.replaceParticipantId` and `resources.replaceLinkTarget`
   * separately.
   */
  mergeNodes(
    keepId: string,
    mergeId: string,
    provenance: Provenance,
  ): Promise<void>;

  // ─── Edge operations ──────────────────────────────────────────────────

  /**
   * Create or update an edge of `relType` between two nodes. Re-`connect`
   * with the same triple updates properties rather than duplicating, unless
   * the relationship was defined with `multi: true`.
   */
  connect(
    fromId: string,
    toId: string,
    relType: string,
    props: unknown | undefined,
    provenance: Provenance,
  ): Promise<EdgeWriteResult>;

  disconnect(edgeId: string, provenance: Provenance): Promise<void>;

  // ─── Query operations ─────────────────────────────────────────────────

  findNodes(
    className: string,
    where: NodeFilter,
    opts?: FindNodesOpts,
  ): Promise<MemoryNode[]>;

  /**
   * Read a node and its immediate neighbourhood — neighbour IDs, class
   * names, and edge types only. Powers `glove_memory_get`.
   */
  getNodeWithNeighbours(id: string): Promise<NodeWithNeighbours | null>;

  query(spec: QuerySpec): Promise<QueryResult>;
}

export interface FindNodesOpts {
  /**
   * When true, string-typed `eq` filters opportunistically run as fuzzy
   * matches if the property is in `searchableProperties`. The DSL's `fuzzy`
   * operator is preferred for explicit fuzzy lookup; this flag is for the
   * common case where the curator just wants "any close match" without
   * rewriting the filter.
   */
  fuzzy?: boolean;
  limit?: number;
  offset?: number;
}

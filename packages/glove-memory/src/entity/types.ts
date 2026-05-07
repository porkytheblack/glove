import type { Provenance } from "../core/provenance";

/**
 * A vertex in the entity graph. The reader-facing tool surface filters
 * `provenance` out of results; only the curator can fetch it via direct
 * adapter calls when reasoning about whether to re-extract.
 */
export interface MemoryNode {
  id: string;
  className: string;
  props: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  provenance: Provenance[];
}

/**
 * An edge in the entity graph. Edge identity is `(fromId, toId, type)` by
 * default — re-`connect` updates properties rather than duplicating. The
 * `multi: true` flag on a relationship def is the escape hatch for legitimate
 * repetition.
 */
export interface MemoryEdge {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  props?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  provenance: Provenance[];
}

export interface NodeWriteResult {
  id: string;
  /** False when the write matched an existing node via identity keys. */
  created: boolean;
  /** Present if dedup folded this write into an existing node. */
  mergedInto?: string;
}

export interface EdgeWriteResult {
  id: string;
  /** False when an existing `(fromId, toId, type)` edge was updated rather than created. */
  created: boolean;
}

/**
 * Compact view of a node's one-hop neighbourhood — neighbour IDs, class
 * names, and edge types only, *not* full neighbour properties. Enough signal
 * for the agent to decide which neighbours are worth expanding via a follow-up
 * call.
 */
export interface NodeNeighbour {
  edgeId: string;
  edgeType: string;
  /** "out" — this node is the source of the edge. "in" — this node is the target. */
  direction: "out" | "in";
  nodeId: string;
  className: string;
  /** Edge properties, when present on the relationship def. */
  edgeProps?: Record<string, unknown>;
}

export interface NodeWithNeighbours {
  node: MemoryNode;
  neighbours: NodeNeighbour[];
}

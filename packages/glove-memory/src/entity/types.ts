import type { Provenance } from "../core/provenance";

/** A node stored in the entity graph. */
export interface MemoryNode {
  id: string;
  className: string;
  props: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Append-only log of writes that touched this node. */
  provenance: Provenance[];
}

/** An edge stored in the entity graph. */
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
  /** False when the write matched an existing node via identityKeys. */
  created: boolean;
  /** Set when dedup folded this write into an existing node — same as `id`, but explicit so callers can branch. */
  mergedInto?: string;
}

export interface EdgeWriteResult {
  id: string;
  /** False when the existing (fromId, toId, type) edge had its props updated instead of a new one created. */
  created: boolean;
}

import type { MemoryEdge, MemoryNode } from "../entity/types";
import type { Episode } from "../episodic/types";

/**
 * Strip provenance from a node before returning it to the model. The
 * conversational reader never sees provenance; the curator can fetch it
 * via `adapter.getNode(id)` directly when reasoning about whether to
 * re-extract.
 */
export function stripNodeProvenance(node: MemoryNode): Omit<MemoryNode, "provenance"> {
  const { provenance: _provenance, ...rest } = node;
  return rest;
}

export function stripEdgeProvenance(edge: MemoryEdge): Omit<MemoryEdge, "provenance"> {
  const { provenance: _provenance, ...rest } = edge;
  return rest;
}

export function stripEpisodeProvenance(ep: Episode): Omit<Episode, "provenance"> {
  const { provenance: _provenance, ...rest } = ep;
  return rest;
}

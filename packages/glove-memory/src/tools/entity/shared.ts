import { z } from "zod";
import type { ToolResultData } from "glove-core";
import { ProvenanceSchema, type Provenance } from "../../core/provenance";
import {
  MemoryError,
  MemoryNotFoundError,
  MemoryQueryError,
  MemorySchemaError,
  MemoryWriteError,
} from "../../core/errors";
import type { MemoryNode } from "../../entity/types";

/**
 * Convert a thrown error into a structured tool error result. Memory errors
 * surface their `code` (and any extra fields like `matchedIds`) so the model
 * can reason about whether to retry, merge, or abandon the write.
 */
export function errorResult(e: unknown): ToolResultData {
  if (e instanceof MemoryError) {
    const data: Record<string, unknown> = { code: e.code };
    if (e instanceof MemoryWriteError && e.matchedIds) {
      data.matchedIds = e.matchedIds;
    }
    if (e instanceof MemoryQueryError && e.operator) {
      data.operator = e.operator;
    }
    return {
      status: "error",
      message: e.message,
      data,
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  return {
    status: "error",
    message,
    data: null,
  };
}

/**
 * Reader tools never expose provenance to the model. Curators that need
 * provenance call `adapter.getNode` directly outside the tool surface.
 */
export function publicNode(node: MemoryNode): Omit<MemoryNode, "provenance"> {
  const { provenance: _provenance, ...rest } = node;
  return rest;
}

export function publicNodes(nodes: MemoryNode[]): Array<Omit<MemoryNode, "provenance">> {
  return nodes.map(publicNode);
}

/**
 * Curator-facing schema for provenance arguments. Optional `note` is the
 * curator's lever for capturing rationale on identity-merge decisions and
 * property conflicts.
 */
export const ProvenanceArgSchema = ProvenanceSchema;

/** Synthesise a provenance record when the curator omits a field. */
export function fillProvenance(p: Provenance | undefined, fallbackActor: string): Provenance {
  const now = new Date().toISOString();
  return {
    source: p?.source ?? "tool",
    actor: p?.actor ?? fallbackActor,
    timestamp: p?.timestamp ?? now,
    note: p?.note,
  };
}

// re-exports kept for adapters and tools that import from one place
export { z };
export {
  MemoryNotFoundError,
  MemorySchemaError,
  MemoryWriteError,
  MemoryQueryError,
};

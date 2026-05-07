import { z } from "zod";

/**
 * Required on every memory write — to both entity and episodic adapters.
 * Append-only per node, edge, or episode. The conversational reader never
 * sees provenance fields in tool output; the curator can inspect them via
 * `getNode` / `getEpisode` when reasoning about whether to re-extract.
 */
export interface Provenance {
  /** e.g. "conversation:abc/turn:47", "manual", "import:csv:xyz". */
  source: string;
  /** e.g. "curator-run-xyz", "user:don", "system". */
  actor: string;
  /** ISO 8601 instant. */
  timestamp: string;
  /** Free-form rationale. */
  note?: string;
}

export const ProvenanceSchema: z.ZodType<Provenance> = z.object({
  source: z.string().min(1),
  actor: z.string().min(1),
  timestamp: z.string().min(1),
  note: z.string().optional(),
});

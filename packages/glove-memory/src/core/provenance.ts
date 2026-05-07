import { z } from "zod";

/**
 * Required on every write to memory. Append-only per node, edge, episode,
 * resource, and context entry. The reader-facing tool surface filters
 * provenance out of results; only the curator can fetch it via direct
 * adapter calls when reasoning about whether to re-extract.
 */
export interface Provenance {
  /** Where the write originated. Free-form but conventional: `"conversation:<id>/turn:<n>"`, `"manual"`, `"import:<kind>:<id>"`. */
  source: string;
  /** Who initiated the write. Free-form: `"curator-run-xyz"`, `"user:don"`, `"system"`. */
  actor: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Free-form rationale. Recorded verbatim; useful for capturing identity-merge decisions or property conflicts. */
  note?: string;
}

export const ProvenanceSchema: z.ZodType<Provenance> = z.object({
  source: z.string().min(1),
  actor: z.string().min(1),
  timestamp: z.string().min(1),
  note: z.string().optional(),
});

/**
 * Cross-reference between memory primitives. The four subsystems are siblings
 * with separate adapter contracts and tool surfaces; `Link` is the shared
 * vocabulary they use to point at each other (an episode pointing at a
 * Person, a resource pointing at a meeting episode, a context entry pointing
 * at a project entity, etc).
 *
 * The package does not validate that the target exists — adapters stay
 * decoupled. Cross-validation is the curator / orchestrator's job.
 */
export interface Link {
  kind: "entity" | "episode" | "resource";
  /** Entity / episode ID, or resource path. */
  id: string;
  /** Optional free-form label describing the relation (e.g. `"primary-contact"`, `"source-transcript"`). */
  relation?: string;
}

export const LinkSchema: z.ZodType<Link> = z.object({
  kind: z.enum(["entity", "episode", "resource"]),
  id: z.string().min(1),
  relation: z.string().optional(),
});

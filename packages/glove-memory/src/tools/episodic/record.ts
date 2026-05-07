import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { ProvenanceSchema } from "../../core/provenance";
import { MemoryError } from "../../core/errors";
import type { EpisodicMemoryAdapter } from "../../episodic/adapter";
import {
  EpisodeParticipantSchema,
  EpisodeTimeSchema,
} from "../../episodic/types";
import { renderEpisodeKindsBlock } from "../descriptions";

const RecordEpisodeInput = z.object({
  occurredAt: EpisodeTimeSchema.describe(
    "When this happened. ISO 8601 instant for point-in-time events, or { start, end } for events with duration.",
  ),
  content: z
    .string()
    .min(1)
    .describe(
      "Natural-language summary of what happened — this is the primary searchable content for semantic search.",
    ),
  kind: z.string().describe("Episode kind name — must be one of the registered kinds."),
  participants: z
    .array(EpisodeParticipantSchema)
    .describe(
      "Entity IDs involved in this episode, with optional roles. Pass [] if no entities are involved.",
    ),
  properties: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Episode-specific structured data, validated against the kind's propertiesSchema if any.",
    ),
  provenance: ProvenanceSchema,
});

type RecordEpisodeInput = z.infer<typeof RecordEpisodeInput>;

export function createEpisodicRecordTool(
  adapter: EpisodicMemoryAdapter,
): GloveFoldArgs<RecordEpisodeInput> {
  return {
    name: "glove_episodic_record",
    description:
      `Append a new episode to the timeline. Episodes are append-only; there is no merge or identity dedup. ` +
      `If two episodes turn out to be the same event captured twice, delete one rather than merging them.\n\n` +
      `Embeddings are not generated synchronously — the new episode is recorded with embeddingStatus=missing ` +
      `and an out-of-band process fills the vector in later. The episode is immediately findable via ` +
      `glove_episodic_find and glove_episodic_timeline; only glove_episodic_search is gated on embeddings.\n\n` +
      `${renderEpisodeKindsBlock(adapter.schema)}`,
    inputSchema: RecordEpisodeInput,
    async do(input) {
      try {
        const result = await adapter.recordEpisode(
          {
            occurredAt: input.occurredAt,
            content: input.content,
            kind: input.kind,
            participants: input.participants,
            properties: input.properties,
          },
          input.provenance,
        );
        return { status: "success" as const, data: result };
      } catch (e) {
        if (e instanceof MemoryError) {
          return { status: "error" as const, message: `${e.code}: ${e.message}`, data: null };
        }
        throw e;
      }
    },
  };
}

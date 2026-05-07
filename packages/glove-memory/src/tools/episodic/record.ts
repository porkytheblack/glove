import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EpisodicMemoryAdapter } from "../../episodic/adapter";
import { errorResult, fillProvenance, ProvenanceArgSchema, renderEpisodeKindsSection } from "./shared";

const ParticipantSchema = z.object({
  entityId: z.string().min(1),
  role: z.string().optional(),
});

const OccurredAtSchema = z.union([
  z.string(),
  z.object({ start: z.string(), end: z.string() }),
]);

const RecordInputSchema = z.object({
  occurredAt: OccurredAtSchema.describe("ISO 8601 instant or { start, end } interval. Required."),
  content: z.string().describe("Natural-language summary of what happened. The primary searchable surface."),
  kind: z.string().describe("One of the registered episode kinds."),
  participants: z.array(ParticipantSchema).default([]).describe("Entity IDs of participants. The episodic adapter does not validate that the IDs exist — cross-validation is the curator's job."),
  properties: z.record(z.string(), z.unknown()).optional().describe("Episode-specific structured data. Validated against the kind's propertiesSchema."),
  provenance: ProvenanceArgSchema.optional(),
});

export type RecordEpisodeInput = z.infer<typeof RecordInputSchema>;

export function buildEpisodicRecordTool(adapter: EpisodicMemoryAdapter): GloveFoldArgs<RecordEpisodeInput> {
  return {
    name: "glove_episodic_record",
    description:
      `Append a new episode to the timeline. Episodes are events, not entities — they don't dedup, they don't merge, they just accumulate. The embedding for semantic search is generated out-of-band, so the episode is not immediately searchable via glove_episodic_search.\n\n` +
      `${renderEpisodeKindsSection(adapter.schema)}`,
    inputSchema: RecordInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        const result = await adapter.recordEpisode(
          {
            occurredAt: input.occurredAt,
            content: input.content,
            kind: input.kind,
            participants: input.participants,
            properties: input.properties,
          },
          provenance,
        );
        return { status: "success", data: result };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

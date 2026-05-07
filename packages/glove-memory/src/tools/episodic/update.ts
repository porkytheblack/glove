import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EpisodicMemoryAdapter } from "../../episodic/adapter";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";

const ParticipantSchema = z.object({
  entityId: z.string().min(1),
  role: z.string().optional(),
});

const OccurredAtSchema = z.union([
  z.string(),
  z.object({ start: z.string(), end: z.string() }),
]);

const UpdateInputSchema = z.object({
  id: z.string().min(1).describe("ID of the episode to patch."),
  patch: z.object({
    content: z.string().optional(),
    kind: z.string().optional(),
    participants: z.array(ParticipantSchema).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    occurredAt: OccurredAtSchema.optional(),
  }),
  provenance: ProvenanceArgSchema.optional(),
});

export type UpdateEpisodeInput = z.infer<typeof UpdateInputSchema>;

export function buildEpisodicUpdateTool(adapter: EpisodicMemoryAdapter): GloveFoldArgs<UpdateEpisodeInput> {
  return {
    name: "glove_episodic_update",
    description:
      `Patch an existing episode. Used sparingly — for genuine after-the-fact enrichment (in-progress meeting outcome, thinly-described episode getting more detail). Updates that change content mark the episode embedding stale.`,
    inputSchema: UpdateInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        await adapter.updateEpisode(input.id, input.patch, provenance);
        return { status: "success", data: { id: input.id, updated: true } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

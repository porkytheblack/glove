import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { ProvenanceSchema } from "../../core/provenance";
import { MemoryError } from "../../core/errors";
import type { EpisodicMemoryAdapter } from "../../episodic/adapter";
import {
  EpisodeParticipantSchema,
  EpisodeTimeSchema,
} from "../../episodic/types";

const UpdateEpisodeInput = z.object({
  id: z.string().describe("Episode ID to patch."),
  patch: z
    .object({
      content: z.string().optional(),
      kind: z.string().optional(),
      participants: z.array(EpisodeParticipantSchema).optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
      occurredAt: EpisodeTimeSchema.optional(),
    })
    .describe("Fields to update. Updates to `content` mark the embedding stale."),
  provenance: ProvenanceSchema,
});

type UpdateEpisodeInput = z.infer<typeof UpdateEpisodeInput>;

export function createEpisodicUpdateTool(
  adapter: EpisodicMemoryAdapter,
): GloveFoldArgs<UpdateEpisodeInput> {
  return {
    name: "glove_episodic_update",
    description:
      `Patch an existing episode. Use sparingly — episodes are events, not editable records. ` +
      `Legitimate cases: recording an in-progress meeting and patching in the outcome later, ` +
      `or enriching a thinly-described episode with more detail.\n\n` +
      `Updating \`content\` marks the embedding stale; the out-of-band refresh process will pick it up.`,
    inputSchema: UpdateEpisodeInput,
    async do(input) {
      try {
        await adapter.updateEpisode(input.id, input.patch, input.provenance);
        return { status: "success" as const, data: { id: input.id, updated: true } };
      } catch (e) {
        if (e instanceof MemoryError) {
          return { status: "error" as const, message: `${e.code}: ${e.message}`, data: null };
        }
        throw e;
      }
    },
  };
}

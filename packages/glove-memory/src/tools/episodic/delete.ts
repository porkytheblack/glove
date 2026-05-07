import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { ProvenanceSchema } from "../../core/provenance";
import { MemoryError } from "../../core/errors";
import type { EpisodicMemoryAdapter } from "../../episodic/adapter";

const DeleteEpisodeInput = z.object({
  id: z.string().describe("Episode ID to remove."),
  provenance: ProvenanceSchema,
});

type DeleteEpisodeInput = z.infer<typeof DeleteEpisodeInput>;

export function createEpisodicDeleteTool(
  adapter: EpisodicMemoryAdapter,
): GloveFoldArgs<DeleteEpisodeInput> {
  return {
    name: "glove_episodic_delete",
    description:
      `Remove an episode. Use this only for genuine duplicates — for legitimate updates use glove_episodic_update. ` +
      `Episodes are append-only by intent.`,
    inputSchema: DeleteEpisodeInput,
    async do(input) {
      try {
        await adapter.deleteEpisode(input.id, input.provenance);
        return { status: "success" as const, data: { id: input.id, removed: true } };
      } catch (e) {
        if (e instanceof MemoryError) {
          return { status: "error" as const, message: `${e.code}: ${e.message}`, data: null };
        }
        throw e;
      }
    },
  };
}

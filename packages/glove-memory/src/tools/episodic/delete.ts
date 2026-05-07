import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EpisodicMemoryAdapter } from "../../episodic/adapter";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";

const DeleteInputSchema = z.object({
  id: z.string().min(1).describe("ID of the episode to remove."),
  provenance: ProvenanceArgSchema.optional(),
});

export type DeleteEpisodeInput = z.infer<typeof DeleteInputSchema>;

export function buildEpisodicDeleteTool(adapter: EpisodicMemoryAdapter): GloveFoldArgs<DeleteEpisodeInput> {
  return {
    name: "glove_episodic_delete",
    description:
      `Remove an episode. For genuine duplicates only — episodes are append-only, so deletion is rare. Resources that link to this episode are NOT cascaded; the orchestrator must call resources.linksFor("episode", id) and decide what to do.`,
    inputSchema: DeleteInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        await adapter.deleteEpisode(input.id, provenance);
        return { status: "success", data: { id: input.id, removed: true } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

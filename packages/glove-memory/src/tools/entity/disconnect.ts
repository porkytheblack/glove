import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";

const DisconnectInputSchema = z.object({
  edgeId: z.string().min(1).describe("ID of the edge to remove."),
  provenance: ProvenanceArgSchema.optional(),
});

export type DisconnectInput = z.infer<typeof DisconnectInputSchema>;

export function buildDisconnectTool(adapter: EntityMemoryAdapter): GloveFoldArgs<DisconnectInput> {
  return {
    name: "glove_memory_disconnect",
    description: `Remove an edge by its id.`,
    inputSchema: DisconnectInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        await adapter.disconnect(input.edgeId, provenance);
        return { status: "success", data: { edgeId: input.edgeId, removed: true } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

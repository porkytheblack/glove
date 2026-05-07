import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";

const MergeNodesInputSchema = z.object({
  keepId: z.string().min(1).describe("ID of the node to keep. Surviving node after the merge."),
  mergeId: z.string().min(1).describe("ID of the node to fold into `keepId`. Removed after the merge."),
  provenance: ProvenanceArgSchema.optional(),
});

export type MergeNodesInput = z.infer<typeof MergeNodesInputSchema>;

export function buildMergeNodesTool(adapter: EntityMemoryAdapter): GloveFoldArgs<MergeNodesInput> {
  return {
    name: "glove_memory_merge_nodes",
    description:
      `Fold one node into another. Edges incident to mergeId are rewritten to point at keepId; collisions on (fromId, toId, type) are resolved by folding properties into the surviving edge.\n\n` +
      `Episodic and resource cross-references are NOT cascaded — orchestrators must call \`episodic.replaceParticipantId\` and \`resources.replaceLinkTarget\` (or their tool equivalents) separately.`,
    inputSchema: MergeNodesInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        await adapter.mergeNodes(input.keepId, input.mergeId, provenance);
        return {
          status: "success",
          data: { keepId: input.keepId, mergedId: input.mergeId, merged: true },
        };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

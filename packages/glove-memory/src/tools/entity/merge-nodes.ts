import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { ProvenanceSchema } from "../../core/provenance";
import { MemoryError } from "../../core/errors";
import type { EntityMemoryAdapter } from "../../entity/adapter";

const MergeNodesInput = z.object({
  keepId: z.string().describe("Node ID to keep. All edges that referenced mergeId are rewritten to point at this node."),
  mergeId: z.string().describe("Node ID to fold into keepId. After this call, mergeId no longer exists."),
  provenance: ProvenanceSchema,
});

type MergeNodesInput = z.infer<typeof MergeNodesInput>;

export function createMemoryMergeNodesTool(
  adapter: EntityMemoryAdapter,
): GloveFoldArgs<MergeNodesInput> {
  return {
    name: "glove_memory_merge_nodes",
    description:
      `Fold one node into another. Properties from the merged node fill in any missing fields on the kept ` +
      `node; conflicting fields are left untouched and recorded in provenance. All edges that referenced the ` +
      `merged node are rewritten to point at the kept node.\n\n` +
      `IMPORTANT: this tool only updates the entity graph. Episodes that reference mergeId in their participants ` +
      `are NOT updated — the orchestrator must call replaceParticipantId on the episodic adapter after this ` +
      `(see the package's reconciliation responsibilities).`,
    inputSchema: MergeNodesInput,
    async do(input) {
      try {
        await adapter.mergeNodes(input.keepId, input.mergeId, input.provenance);
        return {
          status: "success" as const,
          data: { keepId: input.keepId, mergedAway: input.mergeId },
        };
      } catch (e) {
        if (e instanceof MemoryError) {
          return { status: "error" as const, message: `${e.code}: ${e.message}`, data: null };
        }
        throw e;
      }
    },
  };
}

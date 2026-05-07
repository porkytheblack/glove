import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { ProvenanceSchema } from "../../core/provenance";
import { MemoryError } from "../../core/errors";
import type { EntityMemoryAdapter } from "../../entity/adapter";

const UpdateNodeInput = z.object({
  id: z.string().describe("Node ID to update."),
  props: z.record(z.string(), z.unknown()).describe(
    "Property patch — merged on top of the existing node. Pass only the fields you want to change.",
  ),
  provenance: ProvenanceSchema,
});

type UpdateNodeInput = z.infer<typeof UpdateNodeInput>;

export function createMemoryUpdateNodeTool(
  adapter: EntityMemoryAdapter,
): GloveFoldArgs<UpdateNodeInput> {
  return {
    name: "glove_memory_update_node",
    description:
      `Patch an existing node's properties. The patch is merged on top of the current properties; ` +
      `pass only the fields you want to change. The merged result is validated against the class's ` +
      `schema as a whole, so partial updates that violate required fields will fail.`,
    inputSchema: UpdateNodeInput,
    async do(input) {
      try {
        await adapter.updateNode(input.id, input.props, input.provenance);
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

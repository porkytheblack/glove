import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";
import { renderEntitySchemaSection } from "./render";

const UpdateNodeInputSchema = z.object({
  id: z.string().min(1).describe("ID of the node to patch."),
  props: z.record(z.string(), z.unknown()).describe("Properties to set. Missing keys are left untouched. The merged object is validated against the class schema."),
  provenance: ProvenanceArgSchema.optional(),
});

export type UpdateNodeInput = z.infer<typeof UpdateNodeInputSchema>;

export function buildUpdateNodeTool(adapter: EntityMemoryAdapter): GloveFoldArgs<UpdateNodeInput> {
  return {
    name: "glove_memory_update_node",
    description:
      `Patch a node's properties. Missing keys are left untouched. The merged object is re-validated against the class schema.\n\n` +
      `Schema:\n${renderEntitySchemaSection(adapter.schema)}`,
    inputSchema: UpdateNodeInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        await adapter.updateNode(input.id, input.props, provenance);
        return { status: "success", data: { id: input.id, updated: true } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

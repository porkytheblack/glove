import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";
import { renderEntitySchemaSection } from "./render";

const AddNodeInputSchema = z.object({
  className: z.string().describe("Registered node class name."),
  props: z.record(z.string(), z.unknown()).describe("Node properties. Validated against the class schema. Identity-key matching folds duplicate writes into the existing node."),
  provenance: ProvenanceArgSchema.optional().describe(
    "Source/actor/timestamp for this write. If omitted, the tool fills in defaults (source=\"tool\", actor=\"curator\", timestamp=now). Always supply this when running as part of a curator pipeline.",
  ),
});

export type AddNodeInput = z.infer<typeof AddNodeInputSchema>;

export function buildAddNodeTool(adapter: EntityMemoryAdapter): GloveFoldArgs<AddNodeInput> {
  return {
    name: "glove_memory_add_node",
    description:
      `Create a new node, or upsert into an existing node by identity keys. Returns { id, created }. When created=false the write matched an existing node — missing properties are filled, conflicting properties are left untouched and recorded in provenance.\n\n` +
      `On identity_ambiguous: two distinct nodes matched different identity-key sets. The error data includes \`matchedIds\`. Merge them first via \`glove_memory_merge_nodes\` and retry.\n\n` +
      `Schema:\n${renderEntitySchemaSection(adapter.schema)}`,
    inputSchema: AddNodeInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        const result = await adapter.addNode(input.className, input.props, provenance);
        return { status: "success", data: result };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

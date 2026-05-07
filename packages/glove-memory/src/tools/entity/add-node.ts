import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { ProvenanceSchema } from "../../core/provenance";
import { MemoryError } from "../../core/errors";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { renderEntitySchemaBlock } from "../descriptions";

const AddNodeInput = z.object({
  className: z.string().describe("Node class name — must be one of the registered classes."),
  props: z.record(z.string(), z.unknown()).describe(
    "Properties for the new node, validated against the class's schema. If any registered identityKeys set matches an existing node, the write folds into that node instead of creating a new one.",
  ),
  provenance: ProvenanceSchema.describe(
    "Required: where this write came from. Used for audit trails and conflict resolution.",
  ),
});

type AddNodeInput = z.infer<typeof AddNodeInput>;

export function createMemoryAddNodeTool(
  adapter: EntityMemoryAdapter,
): GloveFoldArgs<AddNodeInput> {
  return {
    name: "glove_memory_add_node",
    description:
      `Create or upsert a node in entity memory. If any identityKeys set on the class matches an ` +
      `existing node, the write folds into that node (created=false) and missing properties are filled in. ` +
      `Conflicting properties on a fold are kept on the existing node and recorded as a conflict in provenance.\n\n` +
      `For fuzzy-then-merge flows: call glove_memory_find with { fuzzy: true } first, decide whether to merge, ` +
      `then call glove_memory_merge_nodes — never let fuzzy lookups silently dedup on the write path.\n\n` +
      `Schema:\n${renderEntitySchemaBlock(adapter.schema)}`,
    inputSchema: AddNodeInput,
    async do(input) {
      try {
        const result = await adapter.addNode(input.className, input.props, input.provenance);
        return { status: "success" as const, data: result };
      } catch (e) {
        if (e instanceof MemoryError) {
          return { status: "error" as const, message: `${e.code}: ${e.message}`, data: null };
        }
        throw e;
      }
    },
  };
}

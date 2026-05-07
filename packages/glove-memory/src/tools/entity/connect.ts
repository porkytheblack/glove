import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";
import { renderEntitySchemaSection } from "./render";

const ConnectInputSchema = z.object({
  fromId: z.string().min(1).describe("Source node id."),
  toId: z.string().min(1).describe("Target node id."),
  type: z.string().min(1).describe("Registered relationship type."),
  props: z.record(z.string(), z.unknown()).optional().describe("Edge properties. Validated against the relationship's edge schema if defined."),
  provenance: ProvenanceArgSchema.optional(),
});

export type ConnectInput = z.infer<typeof ConnectInputSchema>;

export function buildConnectTool(adapter: EntityMemoryAdapter): GloveFoldArgs<ConnectInput> {
  return {
    name: "glove_memory_connect",
    description:
      `Create or update an edge between two nodes. Edge identity is (fromId, toId, type) by default — re-connecting updates properties rather than duplicating, unless the relationship is defined as multi.\n\n` +
      `Schema:\n${renderEntitySchemaSection(adapter.schema)}`,
    inputSchema: ConnectInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        const result = await adapter.connect(
          input.fromId,
          input.toId,
          input.type,
          input.props,
          provenance,
        );
        return { status: "success", data: result };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

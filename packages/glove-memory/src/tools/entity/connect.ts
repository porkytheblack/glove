import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { ProvenanceSchema } from "../../core/provenance";
import { MemoryError } from "../../core/errors";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { renderEntitySchemaBlock } from "../descriptions";

const ConnectInput = z.object({
  fromId: z.string().describe("Source node ID."),
  toId: z.string().describe("Target node ID."),
  type: z.string().describe("Relationship type — must be one of the registered relationships."),
  props: z.record(z.string(), z.unknown()).optional().describe(
    "Optional edge properties, validated against the relationship's propertiesSchema if any.",
  ),
  provenance: ProvenanceSchema,
});

type ConnectInput = z.infer<typeof ConnectInput>;

export function createMemoryConnectTool(
  adapter: EntityMemoryAdapter,
): GloveFoldArgs<ConnectInput> {
  return {
    name: "glove_memory_connect",
    description:
      `Create or update an edge between two nodes. Edge identity is (fromId, toId, type) by default; ` +
      `re-connecting the same pair with the same type updates props rather than creating a duplicate. ` +
      `Relationships defined with multi: true are an exception — they allow multiple edges between the same pair.\n\n` +
      `Schema:\n${renderEntitySchemaBlock(adapter.schema)}`,
    inputSchema: ConnectInput,
    async do(input) {
      try {
        const result = await adapter.connect(
          input.fromId,
          input.toId,
          input.type,
          input.props,
          input.provenance,
        );
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

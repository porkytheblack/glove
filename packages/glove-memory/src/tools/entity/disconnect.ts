import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { ProvenanceSchema } from "../../core/provenance";
import { MemoryError } from "../../core/errors";
import type { EntityMemoryAdapter } from "../../entity/adapter";

const DisconnectInput = z.object({
  edgeId: z.string().describe("Edge ID to remove. Returned by glove_memory_connect or in the neighbour listing of glove_memory_get."),
  provenance: ProvenanceSchema,
});

type DisconnectInput = z.infer<typeof DisconnectInput>;

export function createMemoryDisconnectTool(
  adapter: EntityMemoryAdapter,
): GloveFoldArgs<DisconnectInput> {
  return {
    name: "glove_memory_disconnect",
    description:
      `Remove an edge by id. The endpoints are not affected — only the edge itself.`,
    inputSchema: DisconnectInput,
    async do(input) {
      try {
        await adapter.disconnect(input.edgeId, input.provenance);
        return { status: "success" as const, data: { edgeId: input.edgeId, removed: true } };
      } catch (e) {
        if (e instanceof MemoryError) {
          return { status: "error" as const, message: `${e.code}: ${e.message}`, data: null };
        }
        throw e;
      }
    },
  };
}

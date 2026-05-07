import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { errorResult, publicNode } from "./shared";
import { renderEntitySchemaSection } from "./render";

const GetInputSchema = z.object({
  id: z.string().min(1).describe("ID of the node to fetch."),
});

export type GetNodeInput = z.infer<typeof GetInputSchema>;

export function buildGetNodeTool(adapter: EntityMemoryAdapter): GloveFoldArgs<GetNodeInput> {
  return {
    name: "glove_memory_get",
    description:
      `Fetch a node by id along with its immediate neighbourhood. Neighbours are returned as IDs, class names, and edge types only — not full neighbour properties. Call this tool again with a neighbour's id, or use \`glove_memory_query\`, to expand further.\n\n` +
      `Schema:\n${renderEntitySchemaSection(adapter.schema)}`,
    inputSchema: GetInputSchema,
    async do(input) {
      try {
        const result = await adapter.getNodeWithNeighbours(input.id);
        if (!result) {
          return {
            status: "error",
            message: `No node with id "${input.id}".`,
            data: { code: "not_found" },
          };
        }
        return {
          status: "success",
          data: {
            node: publicNode(result.node),
            neighbours: result.neighbours,
          },
        };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

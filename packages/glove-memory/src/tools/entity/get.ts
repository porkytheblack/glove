import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { renderEntitySchemaBlock } from "../descriptions";
import { stripNodeProvenance } from "../shared";

const GetInput = z.object({
  id: z.string().describe("Node ID — typically returned by glove_memory_find."),
  neighbourLimit: z.number().int().positive().optional().describe("Maximum number of neighbours to include. Defaults to 50."),
});

type GetInput = z.infer<typeof GetInput>;

export function createMemoryGetTool(
  adapter: EntityMemoryAdapter,
): GloveFoldArgs<GetInput> {
  return {
    name: "glove_memory_get",
    description:
      `Fetch a node by id along with its one-hop neighbourhood. The node is returned with full properties; ` +
      `neighbours are returned as IDs + class names + edge types only — not their properties. ` +
      `Use glove_memory_query to expand specific relationships with selected properties.\n\n` +
      `Schema:\n${renderEntitySchemaBlock(adapter.schema)}`,
    inputSchema: GetInput,
    async do(input) {
      const node = await adapter.getNode(input.id);
      if (!node) {
        return {
          status: "error" as const,
          message: `Node ${input.id} not found`,
          data: null,
        };
      }
      const limit = input.neighbourLimit ?? 50;
      const edges = adapter.edgesForNode
        ? await adapter.edgesForNode(node.id, { limit })
        : [];
      const neighbours = await Promise.all(
        edges.map(async (edge) => {
          const otherId = edge.fromId === node.id ? edge.toId : edge.fromId;
          const direction = edge.fromId === node.id ? "out" : "in";
          const other = await adapter.getNode(otherId);
          return {
            edgeId: edge.id,
            edgeType: edge.type,
            direction,
            neighbour: other
              ? { id: other.id, className: other.className }
              : { id: otherId, className: "(missing)" },
          };
        }),
      );
      return {
        status: "success" as const,
        data: {
          node: stripNodeProvenance(node),
          neighbours,
        },
      };
    },
  };
}

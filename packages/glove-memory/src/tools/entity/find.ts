import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { NodeFilterSchema } from "../../entity/query";
import { renderEntitySchemaBlock } from "../descriptions";
import { stripNodeProvenance } from "../shared";

const FindInput = z.object({
  className: z.string().describe("Node class to query — must be one of the registered classes."),
  where: NodeFilterSchema.describe(
    "Filter expression. Each key is a property name; each value is a single filter op or an array of ops that all must hold.",
  ),
  fuzzy: z.boolean().optional().describe("Enable fuzzy matching on `searchableProperties`. Required if any filter uses the `fuzzy` op."),
  limit: z.number().int().positive().optional().describe("Maximum nodes to return."),
  offset: z.number().int().nonnegative().optional().describe("Number of nodes to skip — use for pagination."),
});

type FindInput = z.infer<typeof FindInput>;

export function createMemoryFindTool(
  adapter: EntityMemoryAdapter,
): GloveFoldArgs<FindInput> {
  return {
    name: "glove_memory_find",
    description:
      `Find entity-memory nodes by class and structured filter. Returns matching nodes with full properties (provenance excluded).\n\n` +
      `Filter operators:\n` +
      `- eq, neq, in, not_in, exists, contains, starts_with, ends_with\n` +
      `- gt, gte, lt, lte, between\n` +
      `- fuzzy (requires { fuzzy: true } and a property listed under that class's searchableProperties)\n\n` +
      `Schema:\n${renderEntitySchemaBlock(adapter.schema)}`,
    inputSchema: FindInput,
    async do(input) {
      const nodes = await adapter.findNodes(input.className, input.where, {
        fuzzy: input.fuzzy,
        limit: input.limit,
        offset: input.offset,
      });
      return {
        status: "success" as const,
        data: { nodes: nodes.map(stripNodeProvenance) },
      };
    },
  };
}

import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { NodeFilterSchema } from "../../entity/query";
import { errorResult, publicNodes } from "./shared";
import { renderEntitySchemaSection } from "./render";

const FindInputSchema = z.object({
  className: z.string().describe("Name of the registered node class to search."),
  where: NodeFilterSchema.describe(
    "Property filter map. Each property maps to a single operator object (e.g. { eq: \"alice\" }) or an array of operators (interpreted as AND).",
  ).default({} as Record<string, never>),
  fuzzy: z
    .boolean()
    .optional()
    .describe(
      "When true, string-typed `eq` filters opportunistically run as fuzzy matches if the property is in `searchableProperties`. Use the explicit `fuzzy` operator for non-`eq` lookups.",
    ),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

export type FindNodesInput = z.infer<typeof FindInputSchema>;

export function buildFindNodesTool(adapter: EntityMemoryAdapter): GloveFoldArgs<FindNodesInput> {
  return {
    name: "glove_memory_find",
    description:
      `Find entity nodes by class and property filter. Supports operators eq, neq, in, not_in, exists, fuzzy, contains, starts_with, ends_with, gt, gte, lt, lte, between.\n\n` +
      `Schema:\n${renderEntitySchemaSection(adapter.schema)}`,
    inputSchema: FindInputSchema,
    async do(input) {
      try {
        const results = await adapter.findNodes(
          input.className,
          input.where as Record<string, never>,
          { fuzzy: input.fuzzy, limit: input.limit, offset: input.offset },
        );
        return {
          status: "success",
          data: { nodes: publicNodes(results), count: results.length },
        };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

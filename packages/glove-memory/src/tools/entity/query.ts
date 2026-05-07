import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { QuerySpecSchema, type QuerySpec } from "../../entity/query";
import { errorResult } from "./shared";
import { renderEntitySchemaSection } from "./render";

export function buildQueryTool(adapter: EntityMemoryAdapter): GloveFoldArgs<QuerySpec> {
  return {
    name: "glove_memory_query",
    description:
      `Run a structured graph query. Specify the root class in \`from\`, optional \`where\` filter, optional \`expand\` map keyed by relationship type for traversal (recursive), and optional \`select\`, \`orderBy\`, \`limit\`, \`offset\`.\n\n` +
      `Operators on \`where\`: eq, neq, in, not_in, exists, fuzzy, contains, starts_with, ends_with, gt, gte, lt, lte, between.\n\n` +
      `Schema:\n${renderEntitySchemaSection(adapter.schema)}`,
    inputSchema: QuerySpecSchema,
    async do(input) {
      try {
        const result = await adapter.query(input);
        return { status: "success", data: result };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

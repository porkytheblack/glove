import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { QuerySpecSchema, type QuerySpec } from "../../entity/query";
import { renderEntitySchemaBlock } from "../descriptions";

export function createMemoryQueryTool(
  adapter: EntityMemoryAdapter,
): GloveFoldArgs<QuerySpec> {
  return {
    name: "glove_memory_query",
    description:
      `Run a structured query against entity memory. Supports filtering on the root class, ` +
      `relationship traversal via \`expand\` (recursive), property allowlist via \`select\`, ` +
      `ordering, and pagination. Returns rows with related neighbourhoods inlined.\n\n` +
      `Use this instead of glove_memory_get when you know in advance which neighbours and ` +
      `properties you want — it avoids the round-trip of fetch-then-expand.\n\n` +
      `Schema:\n${renderEntitySchemaBlock(adapter.schema)}`,
    inputSchema: QuerySpecSchema,
    async do(input) {
      const result = await adapter.query(input);
      return {
        status: "success" as const,
        data: result,
      };
    },
  };
}

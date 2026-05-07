import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import { errorResult, renderResourceRootsSection } from "./shared";

const SearchInputSchema = z.object({
  query: z.string().min(1),
  path: z.string().optional().describe("Restrict to a subtree."),
  contentTypes: z.array(z.enum(["text", "markdown", "url"])).optional(),
  recencyWeight: z.number().min(0).max(1).optional(),
  limit: z.number().int().positive().optional(),
});

export type ResourceSearchInput = z.infer<typeof SearchInputSchema>;

export function buildResourcesSearchTool(adapter: ResourceFsAdapter): GloveFoldArgs<ResourceSearchInput> {
  return {
    name: "glove_resources_search",
    description:
      `Semantic search over resource bodies. Use for "find me notes about the regulatory licensing approach" — when you have a topic but no path or filename to grep for.\n\n` +
      `${renderResourceRootsSection(adapter.schema)}`,
    inputSchema: SearchInputSchema,
    async do(input) {
      try {
        if (!adapter.searchSemantic) {
          return {
            status: "error",
            message: "This adapter does not support semantic search.",
            data: { code: "semantic_search_unsupported" },
          };
        }
        const results = await adapter.searchSemantic(input.query, {
          path: input.path,
          contentTypes: input.contentTypes,
          recencyWeight: input.recencyWeight,
          limit: input.limit,
        });
        return { status: "success", data: { results, count: results.length } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import { errorResult } from "./shared";

const GrepInputSchema = z.object({
  query: z.string().min(1),
  regex: z.boolean().optional().describe("Treat query as a regex when true. Default false (literal substring)."),
  caseSensitive: z.boolean().optional(),
  path: z.string().optional().describe("Restrict to a subtree. Default \"/\"."),
  contentTypes: z.array(z.enum(["text", "markdown", "url"])).optional(),
  contextLines: z.number().int().nonnegative().optional().describe("Lines of context around each match. Default 2."),
  limit: z.number().int().positive().optional(),
});

export type GrepInput = z.infer<typeof GrepInputSchema>;

export function buildResourcesGrepTool(adapter: ResourceFsAdapter): GloveFoldArgs<GrepInput> {
  return {
    name: "glove_resources_grep",
    description:
      `Text/regex search across the resource tree. Returns matches with paths, line numbers, and surrounding context. URL bodies without cachedText are skipped.`,
    inputSchema: GrepInputSchema,
    async do(input) {
      try {
        const matches = await adapter.grep(input);
        return { status: "success", data: { matches, count: matches.length } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

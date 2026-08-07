import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import { errorResult, renderResourceGuidance } from "./shared";

const GlobInputSchema = z.object({
  pattern: z.string().min(1).describe("Glob pattern. Supports `*`, `**`, and `?`."),
  path: z.string().optional().describe("Restrict to a subtree."),
  limit: z.number().int().positive().optional(),
});

export type GlobInput = z.infer<typeof GlobInputSchema>;

export function buildResourcesGlobTool(adapter: ResourceFsAdapter): GloveFoldArgs<GlobInput> {
  return {
    name: "glove_resources_glob",
    description: `Find paths by name pattern. Use for "give me every transcript file under /transcripts" — content-blind, fast.` +
      renderResourceGuidance(adapter, { roots: false }),
    inputSchema: GlobInputSchema,
    async do(input) {
      try {
        const paths = await adapter.glob(input.pattern, {
          path: input.path,
          limit: input.limit,
        });
        return { status: "success", data: { paths, count: paths.length } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

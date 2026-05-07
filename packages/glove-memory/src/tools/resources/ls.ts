import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import { errorResult, renderResourceRootsSection } from "./shared";

const LsInputSchema = z.object({
  path: z.string().describe("Absolute POSIX path to list. Use \"/\" for the root."),
  recursive: z.boolean().optional().describe("When true, descend into subdirectories. Default false."),
  limit: z.number().int().positive().optional(),
});

export type LsInput = z.infer<typeof LsInputSchema>;

export function buildResourcesLsTool(adapter: ResourceFsAdapter): GloveFoldArgs<LsInput> {
  return {
    name: "glove_resources_ls",
    description:
      `List directory contents — names, kinds, summaries, tags, sizes, and updatedAt timestamps. Use this to browse the filesystem the same way you would in a shell.\n\n` +
      `${renderResourceRootsSection(adapter.schema)}`,
    inputSchema: LsInputSchema,
    async do(input) {
      try {
        const entries = await adapter.list(input.path, {
          recursive: input.recursive,
          limit: input.limit,
        });
        return { status: "success", data: { path: input.path, entries, count: entries.length } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

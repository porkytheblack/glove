import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import { errorResult, publicFile, renderResourceRootsSection } from "./shared";

const ReadInputSchema = z.object({
  path: z.string().min(1),
  range: z
    .tuple([z.number().int(), z.number().int()])
    .optional()
    .describe("Inclusive 1-indexed line range. Default [1, 50]. Pass [start, -1] to read to EOF."),
});

export type ReadInput = z.infer<typeof ReadInputSchema>;

export function buildResourcesReadTool(adapter: ResourceFsAdapter): GloveFoldArgs<ReadInput> {
  return {
    name: "glove_resources_read",
    description:
      `Read a file body, with optional line range. Defaults to the first 50 lines — call again with a wider range or use \`stat\` first when you suspect a long file.\n\n` +
      `${renderResourceRootsSection(adapter.schema)}`,
    inputSchema: ReadInputSchema,
    async do(input) {
      try {
        const file = await adapter.read(input.path, { range: input.range });
        return { status: "success", data: { file: publicFile(file) } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

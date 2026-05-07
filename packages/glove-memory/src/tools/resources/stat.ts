import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import { errorResult } from "./shared";

const StatInputSchema = z.object({
  path: z.string().min(1),
});

export type StatInput = z.infer<typeof StatInputSchema>;

export function buildResourcesStatTool(adapter: ResourceFsAdapter): GloveFoldArgs<StatInput> {
  return {
    name: "glove_resources_stat",
    description: `Get metadata about a single path — kind (file/directory), size, contentType, summary, tags, links, createdAt, updatedAt. Returns null if the path does not exist.`,
    inputSchema: StatInputSchema,
    async do(input) {
      try {
        const stat = await adapter.stat(input.path);
        return { status: "success", data: { stat } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

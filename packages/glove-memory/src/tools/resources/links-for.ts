import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import { errorResult } from "./shared";

const LinksForInputSchema = z.object({
  targetKind: z.enum(["entity", "episode", "resource"]),
  targetId: z.string().min(1),
});

export type LinksForInput = z.infer<typeof LinksForInputSchema>;

export function buildResourcesLinksForTool(adapter: ResourceFsAdapter): GloveFoldArgs<LinksForInput> {
  return {
    name: "glove_resources_links_for",
    description:
      `Reverse-lookup: find resources whose metadata.links target the given entity / episode / resource. Useful for tracing "what notes reference this person?" before deleting or merging.`,
    inputSchema: LinksForInputSchema,
    async do(input) {
      try {
        const paths = await adapter.linksFor(input.targetKind, input.targetId);
        return { status: "success", data: { paths, count: paths.length } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

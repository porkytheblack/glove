import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";

const RemoveInputSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional().describe("Required when removing a non-empty directory. Default false."),
  provenance: ProvenanceArgSchema.optional(),
});

export type RemoveInput = z.infer<typeof RemoveInputSchema>;

export function buildResourcesRemoveTool(adapter: ResourceFsAdapter): GloveFoldArgs<RemoveInput> {
  return {
    name: "glove_resources_remove",
    description:
      `Delete a file or directory. For non-empty directories, pass recursive=true. Resources that link to the removed paths are NOT cascaded — orchestrators must call linksFor / replaceLinkTarget separately.`,
    inputSchema: RemoveInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        await adapter.remove(input.path, input.recursive ?? false, provenance);
        return { status: "success", data: { path: input.path, removed: true } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

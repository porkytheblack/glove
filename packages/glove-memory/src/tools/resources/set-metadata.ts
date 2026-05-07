import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import {
  errorResult,
  fillProvenance,
  ProvenanceArgSchema,
  ResourceMetadataPatchSchema,
} from "./shared";

const SetMetadataInputSchema = z.object({
  path: z.string().min(1),
  patch: ResourceMetadataPatchSchema,
  provenance: ProvenanceArgSchema.optional(),
});

export type SetMetadataInput = z.infer<typeof SetMetadataInputSchema>;

export function buildResourcesSetMetadataTool(adapter: ResourceFsAdapter): GloveFoldArgs<SetMetadataInput> {
  return {
    name: "glove_resources_set_metadata",
    description:
      `Patch a file's metadata without rewriting the body. Common flow: a user dropped a transcript at \`/transcripts/...\`; on its next pass the curator notices it lacks summary / tags / links and patches them in here.`,
    inputSchema: SetMetadataInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        await adapter.setMetadata(input.path, input.patch, provenance);
        return { status: "success", data: { path: input.path, updated: true } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

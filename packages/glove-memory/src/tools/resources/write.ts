import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import {
  errorResult,
  fillProvenance,
  ProvenanceArgSchema,
  renderResourceRootsSection,
  ResourceBodySchema,
  ResourceMetadataSchema,
} from "./shared";
import type { ResourceMetadata } from "../../resources/types";

const WriteInputSchema = z.object({
  path: z.string().min(1),
  body: ResourceBodySchema,
  metadata: ResourceMetadataSchema.optional().describe(
    "Resource metadata — summary, tags, links, plus any consumer-defined fields. Defaults to empty tags and links.",
  ),
  provenance: ProvenanceArgSchema.optional(),
});

export type WriteInput = z.infer<typeof WriteInputSchema>;

export function buildResourcesWriteTool(adapter: ResourceFsAdapter): GloveFoldArgs<WriteInput> {
  return {
    name: "glove_resources_write",
    description:
      `Create or overwrite a file. Body types: text, markdown, url (with optional cachedText). Marks the file's embedding stale (or missing on initial create) so the lifecycle picks it up.\n\n` +
      `${renderResourceRootsSection(adapter.schema)}`,
    inputSchema: WriteInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        const metadata: ResourceMetadata = input.metadata
          ? { ...input.metadata }
          : { tags: [], links: [] };
        await adapter.write(input.path, input.body, metadata, provenance);
        return { status: "success", data: { path: input.path, written: true } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

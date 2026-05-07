import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";

const MkdirInputSchema = z.object({
  path: z.string().min(1),
  provenance: ProvenanceArgSchema.optional(),
});

export type MkdirInput = z.infer<typeof MkdirInputSchema>;

export function buildResourcesMkdirTool(adapter: ResourceFsAdapter): GloveFoldArgs<MkdirInput> {
  return {
    name: "glove_resources_mkdir",
    description:
      `Create an empty directory. Folders are normally implicit — created when a file is written under them — so use this only when you want an empty folder to exist on its own.`,
    inputSchema: MkdirInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        await adapter.mkdir(input.path, provenance);
        return { status: "success", data: { path: input.path, created: true } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

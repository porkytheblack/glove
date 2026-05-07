import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";

const MoveInputSchema = z.object({
  fromPath: z.string().min(1),
  toPath: z.string().min(1),
  provenance: ProvenanceArgSchema.optional(),
});

export type MoveInput = z.infer<typeof MoveInputSchema>;

export function buildResourcesMoveTool(adapter: ResourceFsAdapter): GloveFoldArgs<MoveInput> {
  return {
    name: "glove_resources_move",
    description:
      `Rename or relocate a file or directory. After moving, links pointing to the old path are NOT cascaded — orchestrators reach for replaceLinkTarget separately.`,
    inputSchema: MoveInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        await adapter.move(input.fromPath, input.toPath, provenance);
        return { status: "success", data: { fromPath: input.fromPath, toPath: input.toPath, moved: true } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

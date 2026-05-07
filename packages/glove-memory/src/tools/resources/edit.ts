import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";

const EditInputSchema = z.object({
  path: z.string().min(1),
  oldStr: z.string().describe("The existing substring to replace. Must match exactly once in the file."),
  newStr: z.string().describe("The replacement text. Can be empty to delete oldStr."),
  provenance: ProvenanceArgSchema.optional(),
});

export type EditInput = z.infer<typeof EditInputSchema>;

export function buildResourcesEditTool(adapter: ResourceFsAdapter): GloveFoldArgs<EditInput> {
  return {
    name: "glove_resources_edit",
    description:
      `Replace a unique substring within a file. Same convention as the str_replace tool — oldStr must match exactly once. If it appears zero times or more than once, the call returns an error.`,
    inputSchema: EditInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "curator");
        await adapter.edit(input.path, input.oldStr, input.newStr, provenance);
        return { status: "success", data: { path: input.path, edited: true } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ContextAdapter } from "../../context/adapter";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";

const UnsetInputSchema = z.object({
  id: z.string().min(1).optional().describe("ID of a single entry to remove."),
  section: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Section name. When provided, removes every entry in the section (the \"forget all my preferences\" flow).",
    ),
  provenance: ProvenanceArgSchema.optional(),
}).refine((v) => Boolean(v.id) !== Boolean(v.section), {
  message: "Provide exactly one of `id` or `section`.",
});

export type UnsetContextInput = z.infer<typeof UnsetInputSchema>;

export function buildContextUnsetTool(adapter: ContextAdapter): GloveFoldArgs<UnsetContextInput> {
  return {
    name: "glove_context_unset",
    description:
      `Remove user context. Provide an entry id to remove a single entry, or a section name to wipe an entire section. Used after "forget about Y" or "I don't want you to assume X anymore".`,
    inputSchema: UnsetInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "user-instructed");
        if (input.id) {
          await adapter.unset(input.id, provenance);
          return { status: "success", data: { id: input.id, removed: true } };
        }
        await adapter.unsetSection(input.section!, provenance);
        return { status: "success", data: { section: input.section, removed: true } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

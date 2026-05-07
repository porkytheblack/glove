import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ContextAdapter } from "../../context/adapter";
import { LinkSchema } from "../../core/provenance";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";

const UpdateInputSchema = z.object({
  id: z.string().min(1).describe("ID of the entry to patch."),
  patch: z
    .object({
      section: z.string().min(1).optional(),
      title: z.string().optional(),
      content: z.string().optional(),
      pinned: z.boolean().optional(),
      expiresAt: z.string().optional(),
      links: z.array(LinkSchema).optional(),
    })
    .describe(
      "Fields to overwrite. Omitted fields are left untouched. Use this to flip an entry from pinned to unpinned, replace a section's content, extend an expiry, etc.",
    ),
  provenance: ProvenanceArgSchema.optional(),
});

export type UpdateContextInput = z.infer<typeof UpdateInputSchema>;

export function buildContextUpdateTool(adapter: ContextAdapter): GloveFoldArgs<UpdateContextInput> {
  return {
    name: "glove_context_update",
    description:
      `Patch an existing user context entry in place. Useful when the user refines a previously stored preference — "actually I prefer X over Y" — without losing the original entry's id and provenance trail. To create a new entry, use glove_context_set instead. To remove one, use glove_context_unset.`,
    inputSchema: UpdateInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "user-instructed");
        await adapter.update(input.id, input.patch, provenance);
        return { status: "success", data: { id: input.id, updated: true } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

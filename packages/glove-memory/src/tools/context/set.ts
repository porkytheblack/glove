import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ContextAdapter } from "../../context/adapter";
import { LinkSchema } from "../../core/provenance";
import { errorResult, fillProvenance, ProvenanceArgSchema } from "./shared";

const SetInputSchema = z.object({
  section: z
    .string()
    .min(1)
    .describe(
      "Free-form section label — \"identity\", \"preferences\", \"glossary\", \"current_task\", or anything the consumer's UI uses.",
    ),
  title: z.string().optional(),
  content: z.string().describe("Markdown body of the entry."),
  pinned: z
    .boolean()
    .default(true)
    .describe(
      "When true (the default), the entry is auto-injected into the system prompt every turn. When false, it's only fetched on demand via glove_context_get.",
    ),
  expiresAt: z
    .string()
    .optional()
    .describe("Optional ISO 8601 expiry. The entry is filtered out of `render` and `list` after this point."),
  links: z.array(LinkSchema).optional(),
  provenance: ProvenanceArgSchema.optional(),
});

export type SetContextInput = z.infer<typeof SetInputSchema>;

export function buildContextSetTool(adapter: ContextAdapter): GloveFoldArgs<SetContextInput> {
  return {
    name: "glove_context_set",
    description:
      `Add or update a user context entry. Use this when the user instructs the agent to remember something — "remember that I prefer X" — or when the agent learns a stable fact about the user that should be available across turns.\n\n` +
      `Pinned entries (the default) are auto-injected into the system prompt every turn. Set pinned=false for occasional context that should only be fetched on demand.`,
    inputSchema: SetInputSchema,
    async do(input) {
      try {
        const provenance = fillProvenance(input.provenance, "user-instructed");
        const result = await adapter.set(
          {
            section: input.section,
            title: input.title,
            content: input.content,
            pinned: input.pinned,
            expiresAt: input.expiresAt,
            links: input.links,
          },
          provenance,
        );
        return { status: "success", data: result };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

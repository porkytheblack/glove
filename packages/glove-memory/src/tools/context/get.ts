import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ContextAdapter } from "../../context/adapter";
import { errorResult, publicEntries } from "./shared";

const GetInputSchema = z.object({
  section: z
    .string()
    .optional()
    .describe(
      "Restrict to a single section (e.g. \"identity\", \"preferences\"). Omit to list all sections.",
    ),
});

export type GetContextInput = z.infer<typeof GetInputSchema>;

export function buildContextGetTool(adapter: ContextAdapter): GloveFoldArgs<GetContextInput> {
  return {
    name: "glove_context_get",
    description:
      `List user context entries — identity, preferences, glossary, current task scope, etc. Pinned entries are already injected into the system prompt every turn; use this tool to fetch unpinned entries on demand or to inspect what is currently stored.`,
    inputSchema: GetInputSchema,
    async do(input) {
      try {
        const entries = await adapter.list(input.section);
        return {
          status: "success",
          data: { entries: publicEntries(entries), count: entries.length },
        };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { errorResult, resolveRunner, type RunnerFactory } from "./shared";

const ListInputSchema = z.object({});

export type ListFormsInput = z.infer<typeof ListInputSchema>;

/**
 * Tier "—" in §4: this reads the registration only. No module import, no zod
 * instantiation, no compile. Listing twenty forms costs twenty name +
 * description pairs and nothing else.
 */
export function buildFormListTool(runner: RunnerFactory): GloveFoldArgs<ListFormsInput> {
  return {
    name: "glove_form_list",
    description:
      "List the forms available to start, with a one-line description of each. " +
      "Use this when the user asks what you can collect, or when you need to pick a form to start. " +
      "Returns names and descriptions only — start a form to see its fields.",
    inputSchema: ListInputSchema,
    async do() {
      try {
        const forms = resolveRunner(runner).list();
        return { status: "success", data: { forms } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import {
  errorResult,
  INSTANCE_ID_DESCRIPTION,
  renderView,
  resolveRunner,
  type RunnerFactory,
} from "./shared";

const StatusInputSchema = z.object({
  instance_id: z.string().optional().describe(INSTANCE_ID_DESCRIPTION),
});

export type FormStatusInput = z.infer<typeof StatusInputSchema>;

/**
 * Tier 1 (§4). The open step in full — every field with `ask: true`, plus the
 * ones already answered for reference. Types, descriptions, current values,
 * validation errors. Everything outside the open step stays unloaded.
 */
export function buildFormStatusTool(
  runner: RunnerFactory,
): GloveFoldArgs<FormStatusInput> {
  return {
    name: "glove_form_status",
    description:
      "Show the step you're currently on: each field's type, what a good answer looks like, what's already answered, " +
      "and anything that failed validation.\n\n" +
      "Fields marked ask=true are what to steer toward now. Fields marked ask=false are answered, not applicable " +
      "given what you know so far, or belong to a later step — you don't need to know which.",
    inputSchema: StatusInputSchema,
    async do(input) {
      try {
        const view = await resolveRunner(runner).status({
          instanceId: input.instance_id,
        });
        return { status: "success", data: renderView(view) };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

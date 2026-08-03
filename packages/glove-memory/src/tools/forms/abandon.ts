import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import {
  errorResult,
  INSTANCE_ID_DESCRIPTION,
  resolveRunner,
  type RunnerFactory,
} from "./shared";

const AbandonInputSchema = z.object({
  reason: z
    .string()
    .min(1)
    .describe("Why it's being closed out — the user declined, changed their mind, or it no longer applies."),
  instance_id: z.string().optional().describe(INSTANCE_ID_DESCRIPTION),
});

export type FormAbandonInput = z.infer<typeof AbandonInputSchema>;

export function buildFormAbandonTool(
  runner: RunnerFactory,
): GloveFoldArgs<FormAbandonInput> {
  return {
    name: "glove_form_abandon",
    description:
      "Close out the open form without finishing it. Use this when the user says they'd rather not continue, or " +
      "when the form turns out to be the wrong one. Answers already given are kept.",
    inputSchema: AbandonInputSchema,
    async do(input) {
      try {
        const instance = await resolveRunner(runner).abandon(input.reason, {
          instanceId: input.instance_id,
        });
        return {
          status: "success",
          data: { instance_id: instance.id, status: instance.status },
        };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

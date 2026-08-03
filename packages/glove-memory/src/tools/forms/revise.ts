import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import {
  errorResult,
  INSTANCE_ID_DESCRIPTION,
  renderFillResult,
  resolveRunner,
  type RunnerFactory,
} from "./shared";

const ReviseInputSchema = z.object({
  field: z.string().min(1).describe("Field id to amend."),
  value: z.unknown().describe("The corrected answer."),
  reason: z
    .string()
    .optional()
    .describe("Why it changed, in a few words. Recorded with the answer."),
  instance_id: z.string().optional().describe(INSTANCE_ID_DESCRIPTION),
});

export type FormReviseInput = z.infer<typeof ReviseInputSchema>;

/**
 * Mechanically identical to `fill` — nothing was locked, so there is nothing
 * to unlock. It exists as its own verb because "they corrected themselves" is
 * a distinct conversational move, and because the reason belongs in
 * provenance.
 */
export function buildFormReviseTool(
  runner: RunnerFactory,
): GloveFoldArgs<FormReviseInput> {
  return {
    name: "glove_form_revise",
    description:
      "Amend an answer the user already gave. Use this when they correct themselves.\n\n" +
      "Nothing is lost by revising: the earlier answer is kept, and if a correction makes some other field stop " +
      "applying, that field's answer is held rather than deleted — change it back and the original answer returns.",
    inputSchema: ReviseInputSchema,
    async do(input) {
      try {
        const result = await resolveRunner(runner).revise(input.field, input.value, {
          instanceId: input.instance_id,
          reason: input.reason,
        });
        return { status: "success", data: renderFillResult(result) };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

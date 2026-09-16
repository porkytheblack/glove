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
  action: z
    .enum(["set", "skip", "retract", "undo", "redo"])
    .default("set")
    .describe(
      '"set" replaces an answer. "skip" resolves a skippable field without a value, with a reason. "retract" withdraws an answer or skip. ' +
        '"undo" steps the last answer back; "redo" puts it forward again.',
    ),
  field: z
    .string()
    .optional()
    .describe(
      "Field id. Required for set, skip and retract. For undo and redo, omit it to act on the most recent answer anywhere on the form.",
    ),
  value: z
    .unknown()
    .optional()
    .describe("The corrected answer. Only for action=set."),
  reason: z
    .string()
    .optional()
    .describe("Why it changed, in a few words. Required and non-empty for skip; e.g. 'User has no website'."),
  instance_id: z.string().optional().describe(INSTANCE_ID_DESCRIPTION),
});

export type FormReviseInput = z.infer<typeof ReviseInputSchema>;

/**
 * Answer changes and skipping behind one verb.
 *
 * They could each be their own tool, but tool schemas are re-sent on every
 * completion call and an eval put them at three quarters of this surface's
 * whole context cost. One enum on a verb the model already has is far cheaper
 * than three more definitions, and "revise" is the right word for every one of
 * these moves anyway.
 */
export function buildFormReviseTool(
  runner: RunnerFactory,
): GloveFoldArgs<FormReviseInput> {
  return {
    name: "glove_form_revise",
    description:
      "Change an answer or record an explicit skip.\n\n" +
      "Use action=skip with a reason when the user has no answer or asks to skip a field marked skippable. " +
      "A skip resolves the field without a value; do not invent N/A or keep asking. Silence alone is not a skip. " +
      "Use action=set to replace a skip with a real answer, or retract to reopen it.\n\n" +
      "Use action=set when they correct themselves, action=retract when they take something back " +
      '("actually, forget the ticket reference"), and action=undo when they want the last thing ' +
      "reversed. action=redo puts back what undo took away.\n\n" +
      "Nothing is ever lost by any of these. Every answer stays on the record, so an undo is always " +
      "reversible and a retraction can be redone. Never blank a field by setting it to an empty " +
      "string or zero — retract it instead, so the real answer survives.",
    inputSchema: ReviseInputSchema,
    async do(input) {
      try {
        const r = resolveRunner(runner);
        const opts = { instanceId: input.instance_id };

        switch (input.action) {
          case "skip": {
            if (!input.field || !input.reason?.trim()) {
              return { status: "error", message: "action=skip needs a field and a non-empty reason.", data: null };
            }
            return { status: "success", data: renderFillResult(await r.skip(input.field, input.reason, opts)) };
          }
          case "undo":
            return { status: "success", data: renderFillResult(await r.undo(input.field, opts)) };
          case "redo":
            return { status: "success", data: renderFillResult(await r.redo(input.field, opts)) };
          case "retract": {
            if (!input.field) {
              return { status: "error", message: "action=retract needs a field.", data: null };
            }
            return {
              status: "success",
              data: renderFillResult(await r.retract(input.field, opts)),
            };
          }
          default: {
            if (!input.field) {
              return { status: "error", message: "action=set needs a field.", data: null };
            }
            const result = await r.revise(input.field, input.value, {
              ...opts,
              reason: input.reason,
            });
            return { status: "success", data: renderFillResult(result) };
          }
        }
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

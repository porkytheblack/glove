import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { FormViewScope } from "../../forms/types";
import {
  errorResult,
  INSTANCE_ID_DESCRIPTION,
  renderView,
  resolveRunner,
  type RunnerFactory,
} from "./shared";

const InspectInputSchema = z.object({
  scope: z
    .enum(["step", "field", "outline"])
    .default("outline")
    .describe(
      "\"outline\" — every step with titles and counts, for answering \"what else will you need from me?\". " +
        "\"step\" — one named step in full. \"field\" — one named field.",
    ),
  id: z
    .string()
    .optional()
    .describe("Step id or field id. Required for scope=field; optional for scope=step."),
  instance_id: z.string().optional().describe(INSTANCE_ID_DESCRIPTION),
});

export type FormInspectInput = z.infer<typeof InspectInputSchema>;

/**
 * Tier 2 (§4). Anything outside the open step, on request.
 *
 * Fields that a branch has gated off come back with `ask: false`, so the
 * agent can answer "what else will you need?" without promising something the
 * form may skip.
 */
export function buildFormInspectTool(
  runner: RunnerFactory,
): GloveFoldArgs<FormInspectInput> {
  return {
    name: "glove_form_inspect",
    description:
      "Look at part of the form you aren't on yet — a named step, a single field, or the whole outline.\n\n" +
      "Use this when the user asks what else you'll need, when they volunteer something that belongs to a later " +
      "step and you need its field id, or when you want to check whether a branch will even ask for something. " +
      "Fields with ask=false may be skipped entirely depending on earlier answers — don't promise them.",
    inputSchema: InspectInputSchema,
    async do(input) {
      try {
        let scope: FormViewScope;
        if (input.scope === "field") {
          if (!input.id) {
            return {
              status: "error",
              message: "scope=field needs an id.",
              data: null,
            };
          }
          scope = { scope: "field", id: input.id };
        } else if (input.scope === "step") {
          scope = { scope: "step", id: input.id };
        } else {
          scope = { scope: "outline" };
        }
        const view = await resolveRunner(runner).inspect(scope, {
          instanceId: input.instance_id,
        });
        return { status: "success", data: renderView(view) };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

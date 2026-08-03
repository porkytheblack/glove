import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import {
  errorResult,
  INSTANCE_ID_DESCRIPTION,
  renderFillResult,
  resolveRunner,
  type RunnerFactory,
} from "./shared";

const FillInputSchema = z.object({
  values: z
    .record(z.string(), z.unknown())
    .describe(
      "Field id → value. Any field in the form, not just the step you're on. " +
        "Send everything you learned in one call.",
    ),
  instance_id: z.string().optional().describe(INSTANCE_ID_DESCRIPTION),
});

export type FormFillInput = z.infer<typeof FillInputSchema>;

/**
 * The write path, and the one the conduct guidance leans on hardest.
 *
 * A user who answers question six while being asked question two has answered
 * question six — so this takes a patch of *any* field ids, validates each
 * independently, and keeps what doesn't apply yet instead of dropping it.
 */
export function buildFormFillTool(runner: RunnerFactory): GloveFoldArgs<FormFillInput> {
  return {
    name: "glove_form_fill",
    description:
      "Record answers. Send every field you learned in one call — you can fill fields from any step, not just the " +
      "one you're on, so capture whatever the user volunteers rather than making them repeat it later.\n\n" +
      "Each value is checked on its own: one bad answer doesn't throw away the others. Anything that fails comes " +
      "back under `rejected` with the reason, and the field stays visible as invalid so you can re-ask just that one. " +
      "Anything that doesn't apply given the current answers comes back under `held` — it's kept, not lost, and " +
      "counts again if the answers change.\n\n" +
      "Returns the refreshed field list for the step you're on.",
    inputSchema: FillInputSchema,
    async do(input) {
      try {
        const result = await resolveRunner(runner).fill(input.values ?? {}, {
          instanceId: input.instance_id,
        });
        return { status: "success", data: renderFillResult(result) };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

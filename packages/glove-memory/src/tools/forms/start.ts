import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import {
  errorResult,
  renderFillResult,
  resolveRunner,
  type RunnerFactory,
} from "./shared";

const StartInputSchema = z.object({
  form: z.string().min(1).describe("Form id, as returned by glove_form_list."),
  values: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Answers you already have — from earlier in the conversation, or from what the user said when asking for this. " +
        "Seeding is free and saves asking twice.",
    ),
});

export type StartFormInput = z.infer<typeof StartInputSchema>;

export function buildFormStartTool(runner: RunnerFactory): GloveFoldArgs<StartFormInput> {
  return {
    name: "glove_form_start",
    description:
      "Begin collecting a form. Returns the first step's fields and how to ask for them.\n\n" +
      "Seed `values` with anything the user has already told you — the answers don't have to belong to the first step, " +
      "and anything that doesn't apply yet is kept rather than dropped.\n\n" +
      "Don't read the returned field list aloud. Work through it conversationally.",
    inputSchema: StartInputSchema,
    async do(input) {
      try {
        const result = await resolveRunner(runner).start(input.form, {
          seed: input.values,
        });
        return { status: "success", data: renderFillResult(result) };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

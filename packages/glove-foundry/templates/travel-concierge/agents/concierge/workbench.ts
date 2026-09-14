import { JsSession, defineFn } from "glove-js";
import { defineRepl, defineWorkingEnvironment } from "glove-foundry";
import { z } from "zod";

/**
 * The workbench is the agent's own sandbox: a virtual filesystem for building
 * up an itinerary document, and a JavaScript REPL for arithmetic the model
 * should not do in its head (totals, date maths, currency).
 *
 * Delete either one if this agent does not need it.
 */
export const conciergeWorkspace = defineWorkingEnvironment({
  options: { limits: { maxVfsBytes: 16 * 1024 * 1024 } },
});

export function conciergeRepl(actor: string, budgetUsd: number) {
  const session = JsSession.create({ actor });
  session.register(defineFn({
    name: "trip__budget",
    description: "Read the traveller's remaining budget in USD",
    input: z.object({}),
    readOnlyHint: true,
    handler: () => ({ budgetUsd }),
  }));
  return defineRepl({ language: "javascript", session });
}

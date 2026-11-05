import { appendFileSync } from "node:fs";
import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { FoundryEchoModel } from "../../echo-model.js";

/**
 * Stands in for a public reminder: every run it assembles appends one line
 * naming the occurrence it was given. Tests count lines to count effects.
 */
export default defineAgent({
  description: "Schedule recovery reminder",
  store: ({ conversationId }) => new MemoryStore(`schedule-crash:${conversationId}`),
  model: (_agent, context) => {
    const log = process.env.FOUNDRY_SCHEDULE_REMINDER_LOG;
    const source = context.request.source;
    if (log && source?.kind === "activation") {
      appendFileSync(log, `${JSON.stringify({
        activationId: source.id, occurrenceId: source.occurrenceId, scheduledFor: source.scheduledFor, runId: context.runId,
      })}\n`);
    }
    return new FoundryEchoModel();
  },
  systemPrompt: "Send the reminder.",
});

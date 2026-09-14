import { Effect } from "effect";
import { defineLayer } from "glove-foundry";

/**
 * A layer reaches the native Glove runtime directly. Use it when you need
 * something a tool cannot express — here, a skill the model can read without
 * spending a tool call.
 */
const tripContext = defineLayer({
  description: "Expose the current Foundry run identity to the agent",
  setup: ({ glove, agentId, runId, history }) => Effect.sync(() => {
    glove.defineSkill({
      name: "trip-context",
      description: "Where this conversation stands",
      exposeToAgent: true,
      async handler() {
        return `agent=${agentId} run=${runId} priorMessages=${history.length}`;
      },
    });
  }),
});

export default tripContext;

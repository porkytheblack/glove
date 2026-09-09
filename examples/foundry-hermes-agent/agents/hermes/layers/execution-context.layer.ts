import { Effect } from "effect";
import { defineLayer } from "glove-foundry";
import { z } from "zod";

const executionContext = defineLayer({
  description: "Expose safe Foundry execution identity without leaking backend internals",
  setup: ({ glove, agentId, conversationId, workspaceId, runId, message }) => Effect.sync(() => {
    glove.fold({
      name: "hermes_execution_context",
      description: "Inspect the current Hermes instance, conversation, workspace, and request",
      inputSchema: z.object({}),
      async do() {
        return {
          status: "success" as const,
          data: {
            agentId,
            conversationId,
            workspaceId,
            runId,
            request: message.text.slice(0, 300),
          },
        };
      },
    });
  }),
});

export default executionContext;

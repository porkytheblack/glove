import { Effect } from "effect";
import { defineLayer } from "glove-foundry";
import { z } from "zod";

const requestContext = defineLayer({
  description: "Expose this Foundry execution's identity to Glove",
  setup: ({ glove, agentId, runId, message, history }) => Effect.sync(() => {
    glove.fold({
      name: "inspect_request_context",
      description: "Return the current Foundry agent and run ids",
      inputSchema: z.object({}),
      async do() {
        return {
          status: "success" as const,
          data: {
            agentId,
            runId,
            message: message.text,
            attachments: message.content?.filter((part) => part.type !== "text").length ?? 0,
            priorMessages: history.length,
          },
        };
      },
    });
  }),
});

export default requestContext;

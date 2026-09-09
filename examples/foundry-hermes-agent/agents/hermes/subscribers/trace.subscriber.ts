import { defineSubscriber } from "glove-foundry";

const traced = new Set([
  "model_response_complete",
  "tool_use_result",
  "subagent_invoked",
  "subagent_completed",
]);

const trace = defineSubscriber({
  description: "Project model, tool, and delegation activity into safe Hermes trace events",
  create: ({ emit }) => ({
    async record(type) {
      if (traced.has(type)) emit({ type: "hermes.trace", data: { type } });
    },
  }),
});

export default trace;

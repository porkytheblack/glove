import { defineSubscriber } from "glove-foundry";

const runAudit = defineSubscriber({
  description: "Observe model and tool activity from the compiled Glove",
  create: ({ emit }) => ({
    async record(type) {
      if (type === "model_response_complete" || type === "tool_use_result") {
        emit({ type: "example.audit", data: { type } });
      }
    },
  }),
});

export default runAudit;

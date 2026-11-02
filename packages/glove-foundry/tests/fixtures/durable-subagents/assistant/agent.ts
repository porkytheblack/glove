import { defineAgent } from "../../../../src/index.js";
import worker from "../researcher/agent.js";
export default defineAgent({
  description: "Assistant with durable research",
  durableSubagents: { research: { agent: worker, inherit: { context: true }, cleanup: async () => {} } },
  run: async (agent, ctx) => {
    if (ctx.messageText === "open work") return (ctx.delegations ?? []).map((task) => task.task);
    if (ctx.messageText === "message origin") return agent.tools.find((tool) => tool.name === "glove_foundry_message")!.run({ to: "research", message: "ping origin" });
    if (ctx.messageText === "delegate held") return agent.tools.find((tool) => tool.name === "glove_foundry_delegate")!.run({ to: "research", task: "hold worker" });
    if (ctx.messageText === "delegate") {
      await agent.tools.find((tool) => tool.name === "glove_foundry_delegate")!.run({ to: "research", task: "Research something" });
    }
    if (ctx.messageText === "message") return agent.tools.find((tool) => tool.name === "glove_foundry_message")!.run({ to: "research", message: "ping parent" });
    return ctx.messageText.includes("spontaneous finding") ? "received finding" : "ok";
  },
});

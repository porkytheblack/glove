import { randomUUID } from "node:crypto";
import { MemoryStore } from "glove-core";
import { defineAgent, FOUNDRY_CORE_COMMAND_EVENT } from "../../../../src/index.js";
import { ToolListingModel } from "../../builtins-tools-model.js";

// Sends a spawn command without the tool that sends it.
export default defineAgent({
  description: "Emits a spawn directly",
  store: ({ conversationId }) => new MemoryStore(conversationId),
  model: () => new ToolListingModel("trusted"),
  systemPrompt: "Fixture",
  run: async (_agent, ctx) => {
    ctx.emit({
      type: FOUNDRY_CORE_COMMAND_EVENT,
      data: { id: randomUUID(), type: "spawn", definitionId: "open", workspaceId: ctx.workspaceId, message: "spawned by trusted" },
    });
    return "sent";
  },
});

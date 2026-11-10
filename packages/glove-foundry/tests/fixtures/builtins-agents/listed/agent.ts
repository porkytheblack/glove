import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { ToolListingModel } from "../../builtins-tools-model.js";

// A bare list is an allow list. Resolved per run.
export default defineAgent({
  description: "Bare list",
  store: ({ conversationId }) => new MemoryStore(conversationId),
  builtins: (_agent, { messageText }) => messageText === "quiet" ? [] : ["glove_foundry_sleep"],
  model: () => new ToolListingModel("listed"),
  systemPrompt: "Fixture",
});

import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { ToolListingModel } from "../../builtins-tools-model.js";

// A block list: everything but these.
export default defineAgent({
  description: "Block list",
  store: ({ conversationId }) => new MemoryStore(conversationId),
  builtins: { block: ["glove_foundry_spawn", "glove_foundry_workspace", "glove_foundry_shared_*"] },
  model: () => new ToolListingModel("blocked"),
  systemPrompt: "Fixture",
});

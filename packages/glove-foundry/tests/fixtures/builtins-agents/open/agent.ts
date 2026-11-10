import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { ToolListingModel } from "../../builtins-tools-model.js";

// No policy: every built-in.
export default defineAgent({
  description: "No policy",
  store: ({ conversationId }) => new MemoryStore(conversationId),
  model: () => new ToolListingModel("open"),
  systemPrompt: "Fixture",
});

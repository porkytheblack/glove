import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { ToolListingModel } from "../../builtins-tools-model.js";

// An allow list: only these, and a built-in added later stays off.
export default defineAgent({
  description: "Allow list",
  store: ({ conversationId }) => new MemoryStore(conversationId),
  mesh: true,
  builtins: { allow: ["glove_foundry_schedule", "glove_mesh_*"] },
  model: () => new ToolListingModel("allowed"),
  systemPrompt: "Fixture",
});

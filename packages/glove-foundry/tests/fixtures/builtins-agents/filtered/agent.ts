import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { ToolListingModel } from "../../builtins-tools-model.js";

// A filter: nothing that reaches workspace-wide data.
export default defineAgent({
  description: "Filter",
  store: ({ conversationId }) => new MemoryStore(conversationId),
  builtins: { filter: (tool) => !tool.workspaceWide },
  model: () => new ToolListingModel("filtered"),
  systemPrompt: "Fixture",
});

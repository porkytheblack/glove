import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { ScriptedModel, log } from "../../mesh-scripted.js";

// Not on the mesh itself: its final reply still goes back to whoever asked.
export default defineAgent({
  description: "Writes code",
  store: ({ conversationId }) => new MemoryStore(conversationId),
  model: () => new ScriptedModel((last) => {
    log("coder-task", { task: last });
    return { say: "hello world done" };
  }),
  systemPrompt: "Fixture worker",
});

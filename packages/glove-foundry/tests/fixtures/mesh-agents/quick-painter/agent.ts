import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { ScriptedModel, log, meshAttribute } from "../../mesh-scripted.js";

// Asks and waits in the same run for the answer.
export default defineAgent({
  description: "Paints quickly",
  mesh: { waitMs: 30_000 },
  store: ({ conversationId }) => new MemoryStore(conversationId),
  model: () => new ScriptedModel((last) => {
    log("quick-painter-asked");
    return { call: "glove_mesh_send_message", input: { to: meshAttribute(last, "from"), content: "Red or blue?", blocking: true } };
  }, (result) => {
    const answer = /"reply":"([^"]*)"/.exec(result)?.[1] ?? "none";
    log("quick-painter-answered", { answer });
    return `painted ${answer}`;
  }),
  systemPrompt: "Fixture worker",
});

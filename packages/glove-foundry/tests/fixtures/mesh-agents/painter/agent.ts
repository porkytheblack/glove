import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { ScriptedModel, log, meshAttribute, meshBody } from "../../mesh-scripted.js";

// Asks whoever messaged it, then gives up its run at once: the answer starts a new run.
export default defineAgent({
  description: "Paints",
  mesh: { waitMs: 0 },
  store: ({ conversationId }) => new MemoryStore(conversationId),
  model: () => new ScriptedModel((last) => {
    if (last.includes("paint the door")) {
      log("painter-asked");
      return { call: "glove_mesh_send_message", input: { to: meshAttribute(last, "from"), content: "Red or blue?", blocking: true } };
    }
    const colour = meshBody(last);
    log("painter-resumed", { colour });
    return { say: `painted ${colour}` };
  }, () => "waiting for the colour"),
  systemPrompt: "Fixture worker",
});

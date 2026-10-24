import { MemoryStore } from "glove-core";
import { defineAgent } from "../../../../src/index.js";
import { ScriptedModel, log } from "../../mesh-scripted.js";

// May only see agents whose data says they share its team, and gets no mesh
// tools at all on a run whose message starts with "quiet".
export default defineAgent({
  description: "Talks only to its own team",
  store: ({ conversationId }) => new MemoryStore(conversationId),
  mesh: {
    peers: (self, peer) => peer.context.team === self.context.team,
    mount: (ctx) => !ctx.messageText.startsWith("quiet"),
  },
  model: () => new ScriptedModel((last) => {
    const to = /^ask:(\S+)/.exec(last)?.[1];
    if (to) return { call: "glove_mesh_send_message", input: { to, content: "write hello" } };
    return { call: "glove_mesh_list_agents", input: {} };
  }, (result) => {
    log("gatekeeper-result", { result });
    return result;
  }),
  systemPrompt: "Fixture gatekeeper",
});

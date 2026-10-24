import { composeAgent, defineAgent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";
import { callModel, interactorModel } from "../../lib/models.js";
import { call, isCall } from "./call.js";
import personal from "./personal.memory.js";
import { interactorPrompt } from "./prompt.js";

/**
 * Layer 1, the interactor. It talks with the person by text or on a call,
 * remembers them, and turns what they want into messages for the workers.
 *
 * This file only assembles. The prompt, memory and call live beside it.
 */
export default defineAgent({
  description: "Talks with the person, remembers them, and hands work to the coder and researcher",
  components: composeAgent(personal),

  model: (_agent, context) => (isCall(context) ? callModel() : interactorModel()),
  systemPrompt: (_agent, context) => interactorPrompt(isCall(context)),
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [personal],

  // Glove Mesh, hosted by Foundry: it messages the person's other agents by
  // id. Who they are is data (lib/team.ts); the coder's reply, or a question
  // it needs answered, comes back to this conversation.
  mesh: true,

  run: (agent, context) => (isCall(context) ? call(agent, context) : context.defaultRun()),
});

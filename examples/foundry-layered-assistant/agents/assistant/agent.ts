import { composeAgent, defineAgent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";
import { callModel, interactorModel } from "../../lib/models.js";
import { call, isCall } from "./call.js";
import personal from "./personal.memory.js";
import { interactorPrompt } from "./prompt.js";

/**
 * Layer 1, the interactor. It talks with the person by text or on a call,
 * remembers them, and turns what they want into tasks for the workers.
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

  // Siblings, by route. Each delegation runs in its own conversation on a
  // worker instance; results and questions come back here.
  delegates: [
    { agent: "coder", description: "Writes and runs code in its own workspace. Takes minutes. Give it the whole task." },
    { agent: "researcher", description: "Reads the web and reports back with sources. Takes a minute or two." },
  ],

  run: (agent, context) => (isCall(context) ? call(agent, context) : context.defaultRun()),
});

import { defineAgent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";
import { builderModel } from "../../lib/models.js";
import { builderPrompt } from "./prompt.js";
import { builderComputer } from "./workspace.js";

/**
 * Where a person's dot starts coding and heavy build jobs, the way a dot starts
 * a task in a coding agent. It has a computer and no access to the person,
 * their channels or the dot's actions. Its final reply goes back to the dot
 * that asked.
 */
export default defineAgent({
  description: "Does heavy jobs for a dot on its own computer and reports back",
  model: builderModel,
  systemPrompt: builderPrompt,
  store: ({ conversationId }) => FileStore.open(conversationId),
  workingEnvironment: builderComputer,
  // It starts nothing. It can still ask the dot that messaged it.
  mesh: { peers: () => false },
});

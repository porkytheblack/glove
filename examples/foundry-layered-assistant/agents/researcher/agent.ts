import { defineAgent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";
import { workerModel } from "../../lib/models.js";
import { researcherPrompt } from "./prompt.js";
import { researcherWorkspace } from "./workspace.js";

/** Layer 2, a worker that reads the web for the interactor. */
export default defineAgent({
  description: "Reads the web and reports back with sources",
  model: () => workerModel("researcher"),
  systemPrompt: researcherPrompt,
  store: ({ conversationId }) => FileStore.open(conversationId),
  workingEnvironment: researcherWorkspace,
  mesh: true,
});

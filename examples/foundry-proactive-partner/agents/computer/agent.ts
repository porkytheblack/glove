import { defineAgent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";
import { computerModel } from "../../lib/models.js";
import { computerPrompt } from "./prompt.js";
import { computer } from "./workspace.js";

/** The partner's computer: long jobs, in its own files, while the partner keeps talking. */
export default defineAgent({
  description: "Builds pages and dashboards and researches across sites for the partner",
  model: computerModel,
  systemPrompt: computerPrompt,
  store: ({ conversationId }) => FileStore.open(conversationId),
  workingEnvironment: computer,
  // It starts nothing. It can still ask the partner that sent the job.
  mesh: { peers: () => false },
});

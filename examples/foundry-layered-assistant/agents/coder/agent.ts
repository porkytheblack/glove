import { defineAgent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";
import { workerModel } from "../../lib/models.js";
import { coderPrompt } from "./prompt.js";
import { coderWorkspace } from "./workspace.js";

/**
 * Layer 2, a worker. It gets tasks from the interactor, works in a sandbox
 * and can ask the interactor a question. It has no memory of the person and
 * no way to message them: that access stays with layer 1.
 */
export default defineAgent({
  description: "Writes and runs code in a sandboxed workspace",
  model: () => workerModel("coder"),
  systemPrompt: coderPrompt,
  store: ({ conversationId }) => FileStore.open(conversationId),
  workingEnvironment: coderWorkspace,
  // Wait up to two minutes in the same run for an answer before suspending.
  answerWaitMs: 120_000,
});

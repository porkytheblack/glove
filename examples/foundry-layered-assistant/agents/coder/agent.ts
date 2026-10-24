import { defineAgent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";
import { workerModel } from "../../lib/models.js";
import { coderPrompt } from "./prompt.js";
import { coderWorkspace } from "./workspace.js";

/**
 * Layer 2, a worker. It gets work from the interactor over the mesh, works
 * in a sandbox and can ask the interactor a question. It has no memory of the person and
 * no way to message them: that access stays with layer 1.
 */
export default defineAgent({
  description: "Writes and runs code in a sandboxed workspace",
  model: () => workerModel("coder"),
  systemPrompt: coderPrompt,
  store: ({ conversationId }) => FileStore.open(conversationId),
  workingEnvironment: coderWorkspace,
  // On the mesh so it can ask whoever sent the work; a blocking question
  // waits up to two minutes in the same run before the run suspends.
  mesh: { waitMs: 120_000 },
});

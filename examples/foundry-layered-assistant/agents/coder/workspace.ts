import { defineWorkingEnvironment } from "glove-foundry";
import { fileWorkspaces } from "../../lib/workspaces.js";

/**
 * The coder's sandbox: a virtual filesystem and named scripts that run in
 * worker threads, with no network and no host access. Saved per mesh thread.
 */
export const coderWorkspace = defineWorkingEnvironment({
  persistence: fileWorkspaces,
});

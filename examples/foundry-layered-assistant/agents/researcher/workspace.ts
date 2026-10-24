import { defineWorkingEnvironment } from "glove-foundry";
import { fetchFiles } from "glove-env-fetch";
import { fileWorkspaces } from "../../lib/workspaces.js";

/**
 * The researcher's workspace adds HTTP through env:fetch, limited to public
 * hosts: no private addresses, no credentials. Its only reach is the web.
 */
export const researcherWorkspace = defineWorkingEnvironment({
  options: {
    stdlib: [fetchFiles({ maxResponseBytes: 2_000_000 })],
  },
  persistence: fileWorkspaces,
});

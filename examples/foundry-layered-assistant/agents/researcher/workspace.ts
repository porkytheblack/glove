import { defineWorkingEnvironment, foundryDataEnvironmentPersistence } from "glove-foundry";
import { fetchFiles } from "glove-env-fetch";

/**
 * The researcher's workspace adds HTTP through env:fetch, limited to public
 * hosts: no private addresses, no credentials. Its only reach is the web.
 */
export const researcherWorkspace = defineWorkingEnvironment({
  options: {
    stdlib: [fetchFiles({ maxResponseBytes: 2_000_000 })],
  },
  // Saved per delegation: each task is its own conversation, and a follow-up
  // on the same delegation finds the files it left.
  persistence: foundryDataEnvironmentPersistence({ scope: "conversation" }),
});

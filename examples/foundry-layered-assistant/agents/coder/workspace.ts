import { defineWorkingEnvironment, foundryDataEnvironmentPersistence } from "glove-foundry";

/**
 * The coder's sandbox: a virtual filesystem and named scripts that run in
 * worker threads, with no network and no host access. Saved per mesh thread.
 */
export const coderWorkspace = defineWorkingEnvironment({
  persistence: foundryDataEnvironmentPersistence({ scope: "conversation" }),
});

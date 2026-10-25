import { defineWorkingEnvironment, foundryDataEnvironmentPersistence } from "glove-foundry";
import { fetchFiles } from "glove-env-fetch";

/**
 * One computer per person, shared by all their bots: files one bot writes
 * under /workspace, another can read. Foundry saves it per workspace, and the
 * workspace is the person. Saves replace the whole snapshot, so two bots
 * writing at once keep the last one; on Kuiper, a sandbox and a browser per
 * person replace it with one live machine.
 */
export const computer = defineWorkingEnvironment({
  options: { stdlib: [fetchFiles({ maxResponseBytes: 2_000_000 })] },
  persistence: foundryDataEnvironmentPersistence({ scope: "workspace" }),
});

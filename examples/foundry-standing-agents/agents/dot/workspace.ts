import { defineWorkingEnvironment, foundryDataEnvironmentPersistence } from "glove-foundry";
import { fetchFiles } from "glove-env-fetch";

/**
 * The dot's own computer: files, scripts and the public web through env:fetch.
 * Saved per dot by Foundry's data adapter. On Kuiper, a sandbox and a browser
 * per dot replace it (see the README).
 */
export const dotComputer = defineWorkingEnvironment({
  options: { stdlib: [fetchFiles({ maxResponseBytes: 2_000_000 })] },
  persistence: foundryDataEnvironmentPersistence({ scope: "agent" }),
});

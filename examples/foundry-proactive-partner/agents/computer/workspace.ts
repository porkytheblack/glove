import { defineWorkingEnvironment, foundryDataEnvironmentPersistence } from "glove-foundry";
import { fetchFiles } from "glove-env-fetch";

/**
 * The computer's files are saved per instance, not per task, so what it built
 * last week is still there. env:fetch gives it the public web. On Kuiper, a
 * sandbox and a browser per person replace this (see the README).
 */
export const computer = defineWorkingEnvironment({
  options: { stdlib: [fetchFiles({ maxResponseBytes: 2_000_000 })] },
  persistence: foundryDataEnvironmentPersistence({ scope: "agent" }),
});

import { defineWorkingEnvironment, foundryDataEnvironmentPersistence } from "glove-foundry";
import { fetchFiles } from "glove-env-fetch";

/**
 * The builder's computer: a virtual filesystem and scripts that run in worker
 * threads, plus HTTP to public hosts through env:fetch. Saved per instance by
 * Foundry's data adapter, so files from last week's job are still there.
 */
export const builderComputer = defineWorkingEnvironment({
  options: {
    stdlib: [fetchFiles({ maxResponseBytes: 2_000_000 })],
  },
  persistence: foundryDataEnvironmentPersistence({ scope: "agent" }),
});

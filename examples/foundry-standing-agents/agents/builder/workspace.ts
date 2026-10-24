import { defineWorkingEnvironment } from "glove-foundry";
import { fetchFiles } from "glove-env-fetch";
import { perInstance } from "../../lib/computers.js";

/**
 * The builder's computer: a virtual filesystem and scripts that run in worker
 * threads, plus HTTP to public hosts through env:fetch. Saved per instance.
 */
export const builderComputer = defineWorkingEnvironment({
  options: {
    stdlib: [fetchFiles({ maxResponseBytes: 2_000_000 })],
  },
  persistence: perInstance,
});

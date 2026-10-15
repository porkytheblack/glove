import { FileFoundryDataAdapter, defineApplication } from "glove-foundry";
import { fileURLToPath } from "node:url";

/**
 * Instances, conversations, schedules and workspace data are saved to
 * `.data/foundry.json`, so they survive restarts — including the restart
 * `dev` performs every time you save a file. Delete `.data/` to start fresh.
 * Use a database-backed adapter when several hosts share one runtime.
 */
export const data = new FileFoundryDataAdapter({
  file: fileURLToPath(new URL("./.data/foundry.json", import.meta.url)),
});

export default defineApplication({
  name: "{{projectName}}",
  data,
  accounts: [],
  routes: [],
  bindings: [],
});

import { MemoryFoundryDataAdapter, defineApplication } from "glove-foundry";

/** Swap this adapter for your own to persist instances across restarts. */
export const data = new MemoryFoundryDataAdapter();

export default defineApplication({
  name: "{{projectName}}",
  data,
  accounts: [],
  routes: [],
  bindings: [],
});

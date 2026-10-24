import { FileFoundryDataAdapter, defineApplication } from "glove-foundry";
import { dataPath } from "./lib/paths.js";

/** Instances, conversations and delegations live in `.data/foundry.json`. */
export const data = new FileFoundryDataAdapter({ file: dataPath("foundry.json") });

export default defineApplication({
  name: "layered-assistant",
  data,
  accounts: [],
  routes: [],
  bindings: [],
});

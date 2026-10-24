import { FileFoundryDataAdapter, defineApplication } from "glove-foundry";
import { requestAuthorization } from "./lib/authorization.js";
import { dataPath } from "./lib/paths.js";

/** Partners, threads, approvals and schedules live in `.data/foundry.json`. */
export const data = new FileFoundryDataAdapter({ file: dataPath("foundry.json") });

export default defineApplication({
  name: "Proactive partner",
  data,
  ...(requestAuthorization ? { requestAuthorization } : {}),
});

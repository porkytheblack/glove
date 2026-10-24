import { FileFoundryDataAdapter, defineApplication } from "glove-foundry";
import { slackBot, slackMessagesIn } from "./agents/dot/topology.js";
import { requestAuthorization } from "./lib/authorization.js";
import { dataPath } from "./lib/paths.js";

/** Dots, builders, their conversations, schedules and mesh threads live in `.data/foundry.json`. */
export const data = new FileFoundryDataAdapter({ file: dataPath("foundry.json") });

export default defineApplication({
  name: "Standing agents",
  data,
  accounts: [slackBot],
  routes: [slackMessagesIn],
  bindings: [],
  ...(requestAuthorization ? { requestAuthorization } : {}),
});

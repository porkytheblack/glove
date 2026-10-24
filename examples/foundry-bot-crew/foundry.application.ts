import { defineApplication } from "glove-foundry";
import { xBot, xMentionsIn } from "./agents/bot/topology.js";
import { requestAuthorization } from "./lib/authorization.js";
import { data } from "./lib/data.js";

export default defineApplication({
  name: "Bot crew",
  data,
  accounts: [xBot],
  routes: [xMentionsIn],
  bindings: [],
  ...(requestAuthorization ? { requestAuthorization } : {}),
});

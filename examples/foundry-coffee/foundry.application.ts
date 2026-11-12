import { FileFoundryDataAdapter, defineAgentInstance, defineApplication } from "glove-foundry";
import barista from "./agents/barista/agent.js";
import { dataPath } from "./lib/paths.js";
import { SHOP } from "./lib/shop.js";

// The shop's barista, seeded in the shop's workspace. A seed is written only
// when the data file has no instance with that id. Customers are
// conversations, created by the web app as people arrive.
const shopBarista = defineAgentInstance(barista, {
  id: SHOP.agentId,
  workspaceId: SHOP.workspaceId,
  name: `${SHOP.name} barista`,
  description: "Takes orders at the counter, typed or spoken",
  context: { shop: SHOP.name },
});

/** Instances, conversations, bags, orders and approvals live in `.data/foundry.json`. */
export const data = new FileFoundryDataAdapter({
  file: dataPath("foundry.json"),
  agents: [shopBarista],
});

export default defineApplication({
  name: "foundry-coffee",
  data,
  accounts: [],
  routes: [],
  bindings: [],
});

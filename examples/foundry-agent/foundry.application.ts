import {
  MemoryFoundryDataAdapter,
  defineApplication,
  defineBinding,
} from "glove-foundry";
import {
  releasePlannerConversation,
  releasePlannerInstance,
} from "./agents/release-planner/instances.js";
import releaseNotes from "./agents/release-planner/apps/release-notes.app.js";
import { supportAccount, supportInbound, supportOutbound } from "./agents/release-planner/topology.js";
import supportTransmission, { supportReply } from "./agents/release-planner/transmissions/support.transmission.js";

export const data = new MemoryFoundryDataAdapter({
  identifier: "foundry-example-data",
  agents: [releasePlannerInstance],
  conversations: [releasePlannerConversation],
});

const binding = defineBinding({
  id: "release-planner-support",
  agent: releasePlannerInstance,
  application: releaseNotes,
  transmission: supportTransmission,
  account: supportAccount,
  route: supportOutbound,
  capabilities: [supportReply],
  reply: { mode: "route", route: supportOutbound },
  enabled: true,
});

export default defineApplication({
  name: "Foundry Example",
  data,
  accounts: [supportAccount],
  routes: [supportInbound, supportOutbound],
  bindings: [binding],
});

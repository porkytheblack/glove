import { FileFoundryDataAdapter, createConversation, defineAgentInstance, defineApplication } from "glove-foundry";
import computer from "./agents/computer/agent.js";
import partner from "./agents/partner/agent.js";
import { requestAuthorization } from "./lib/authorization.js";
import { DEMO_PERSON, computerFor, partnerFor, threadFor } from "./lib/onboarding.js";
import { dataPath } from "./lib/paths.js";

// Ada's account, seeded: her partner with her preferences, its computer and
// her one thread. Seeds are written only when the data file lacks those ids;
// scripts/onboard.ts creates the same records for anyone else.
const ada = defineAgentInstance(partner, partnerFor(DEMO_PERSON));

/** Partners, threads, approvals and schedules live in `.data/foundry.json`. */
export const data = new FileFoundryDataAdapter({
  file: dataPath("foundry.json"),
  agents: [ada, defineAgentInstance(computer, computerFor(DEMO_PERSON))],
  conversations: [createConversation(ada, threadFor(DEMO_PERSON))],
});

export default defineApplication({
  name: "Proactive partner",
  data,
  ...(requestAuthorization ? { requestAuthorization } : {}),
});

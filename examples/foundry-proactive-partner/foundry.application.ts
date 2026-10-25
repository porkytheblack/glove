import { FileFoundryDataAdapter, createConversation, defineAgentInstance, defineApplication } from "glove-foundry";
import computer from "./agents/computer/agent.js";
import partner from "./agents/partner/agent.js";
import { readAccount, saveAccount, services } from "./lib/accounts.js";
import { requestAuthorization } from "./lib/authorization.js";
import { accountFor, gmailRoutes, installationFor, sampleConnection, sendBinding, type AppName } from "./lib/connect.js";
import { DEMO_PERSON, computerFor, partnerFor, threadFor } from "./lib/onboarding.js";
import { dataPath } from "./lib/paths.js";

// Ada's account, seeded: sample Gmail and Calendar accounts, her partner with
// both apps and her preferences, its computer and her one thread. Seeds are
// written only when nothing has those ids yet, so connecting her real
// accounts later (same ids) is kept. scripts/onboard.ts and scripts/connect.ts
// create the same records for anyone else.
const sample = (app: AppName) => accountFor(DEMO_PERSON, app, sampleConnection(DEMO_PERSON, app).identity, true);
const adaGmail = sample("gmail");
const adaCalendar = sample("calendar");
for (const account of [adaGmail, adaCalendar]) {
  if (!(await readAccount(account.id))) await saveAccount(account, sampleConnection(DEMO_PERSON, account.app as AppName).tokens);
}

const ada = defineAgentInstance(partner, {
  ...partnerFor(DEMO_PERSON),
  installations: [installationFor(adaGmail), installationFor(adaCalendar)],
});

/** Partners, threads, approvals and schedules live in `.data/foundry.json`. */
export const data = new FileFoundryDataAdapter({
  file: dataPath("foundry.json"),
  agents: [ada, defineAgentInstance(computer, computerFor(DEMO_PERSON))],
  conversations: [createConversation(ada, threadFor(DEMO_PERSON))],
});

const adaRoutes = gmailRoutes(adaGmail.id);

export default defineApplication({
  name: "Proactive partner",
  data,
  // Accounts come from your store (lib/accounts.ts); routes and bindings written
  // when someone connects an app are kept in .data/topology.json.
  services,
  routes: [adaRoutes.in, adaRoutes.out],
  bindings: [sendBinding(ada.id, adaGmail.id)],
  ...(requestAuthorization ? { requestAuthorization } : {}),
});

import { FileFoundryDataAdapter, createConversation, defineAgentInstance, defineApplication, install } from "glove-foundry";
import muse from "./agents/muse/agent.js";
import whatsappApp from "./agents/muse/apps/whatsapp.app.js";
import { museNumber, whatsappIn } from "./agents/muse/topology.js";
import { readAccount, saveAccount, servicesWith } from "./lib/accounts.js";
import { requestAuthorization } from "./lib/authorization.js";
import { accountFor, gmailRoutes, installationFor, sampleConnection, sendBinding, whatsappFor } from "./lib/connect.js";
import { dataPath } from "./lib/paths.js";
import { ROSA, channel, museFor } from "./lib/people.js";

/**
 * The demo person: Rosa, with sample Gmail and Calendar accounts (both read
 * only to start), her WhatsApp number, her Muse and its two conversations.
 * Seeds are written only when nothing has that id yet, so what Rosa changes
 * afterwards is kept. Everyone else signs up at runtime (scripts/onboard.ts).
 */
const rosaGmail = accountFor(ROSA, "gmail", sampleConnection(ROSA).identity, true);
const rosaCalendar = accountFor(ROSA, "calendar", sampleConnection(ROSA).identity, true);
for (const account of [rosaGmail, rosaCalendar]) {
  if (!(await readAccount(account.id))) await saveAccount(account, sampleConnection(ROSA).tokens);
}

const rosaMuse = defineAgentInstance(muse, {
  ...museFor(ROSA),
  installations: [installationFor(rosaGmail, "read"), installationFor(rosaCalendar, "read"), install(whatsappApp, undefined, { account: museNumber })],
});

/** Muses, their conversations and the Sentinel's lists live in `.data/foundry.json`. */
export const data = new FileFoundryDataAdapter({
  file: dataPath("foundry.json"),
  agents: [rosaMuse],
  conversations: [createConversation(rosaMuse, channel(rosaMuse.id, "app")), createConversation(rosaMuse, channel(rosaMuse.id, "whatsapp"))],
});

const rosaMail = gmailRoutes(rosaGmail.id);
const rosaWhatsApp = whatsappFor(rosaMuse.id, { id: ROSA.id, phone: ROSA.phone! });

export default defineApplication({
  name: "Muse",
  data,
  // Accounts come from your store (lib/accounts.ts), plus Muse's own WhatsApp
  // number; routes and bindings written at runtime are kept in .data/topology.json.
  services: servicesWith([museNumber]),
  routes: [rosaMail.in, rosaMail.out, whatsappIn, rosaWhatsApp.out],
  // Gmail starts read only, so its send binding is off.
  bindings: [sendBinding(rosaMuse.id, rosaGmail.id, false), rosaWhatsApp.binding],
  ...(requestAuthorization ? { requestAuthorization } : {}),
});

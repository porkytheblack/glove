import { FileFoundryDataAdapter, createConversation, defineAgentInstance, defineApplication } from "glove-foundry";
import bot from "./agents/bot/agent.js";
import { readAccount, saveAccount, services } from "./lib/accounts.js";
import { requestAuthorization } from "./lib/authorization.js";
import { accountFor, gmailRoutes, installationFor, sampleConnection, sendBinding } from "./lib/connect.js";
import { dataPath } from "./lib/paths.js";
import { MAYA, botFor, chatWith } from "./lib/people.js";

/**
 * The demo account: Maya, with a sample Gmail and her first bot, Inbox Manager,
 * whose routine runs on new mail. Her other bots are its siblings, made at runtime.
 * Seeds are written only when nothing has that id yet, so everything Maya
 * changes afterwards (a rename, a new bot, connecting her real Gmail under the
 * same id) is kept. Everyone else signs up and connects apps at runtime.
 */
const mayaGmail = accountFor(MAYA, "gmail", sampleConnection(MAYA, "gmail").identity, true);
if (!(await readAccount(mayaGmail.id))) await saveAccount(mayaGmail, sampleConnection(MAYA, "gmail").tokens);

const mayaInbox = defineAgentInstance(bot, botFor(MAYA, {
  id: "maya-inbox",
  name: "Inbox Manager",
  job: "Keeps Maya's inbox moving: answers what it can from her address and hands the rest to the bot whose job it is.",
  routines: [{ on: "new-mail", instruction: "Read each new email. Answer the ones you can; hand the rest to a sibling or tell Maya in one line." }],
  installations: [installationFor(mayaGmail)],
}));
const mayaInboxChat = createConversation(mayaInbox, chatWith(mayaInbox.id));

/** People, their bots, conversations, threads and skills live in `.data/foundry.json`. */
export const data = new FileFoundryDataAdapter({
  file: dataPath("foundry.json"),
  agents: [mayaInbox],
  conversations: [mayaInboxChat],
});

const mayaRoutes = gmailRoutes(mayaGmail.id);

export default defineApplication({
  name: "Bot crew",
  data,
  // Accounts come from your store (lib/accounts.ts); routes and bindings written
  // when someone connects an app are kept in .data/topology.json.
  services,
  routes: [mayaRoutes.in, mayaRoutes.out],
  bindings: [sendBinding(mayaInbox.id, mayaGmail.id)],
  ...(requestAuthorization ? { requestAuthorization } : {}),
});

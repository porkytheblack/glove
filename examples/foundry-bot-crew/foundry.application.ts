import { FileFoundryDataAdapter, createConversation, defineAgentInstance, defineApplication } from "glove-foundry";
import bot from "./agents/bot/agent.js";
import { readAccount, saveAccount, services } from "./lib/accounts.js";
import { requestAuthorization } from "./lib/authorization.js";
import { accountFor, gmailRoutes, installationFor, sampleConnection, sendBinding } from "./lib/connect.js";
import { dataPath } from "./lib/paths.js";
import { MAIN_THREAD, MAYA, mainBotFor } from "./lib/people.js";

/**
 * The demo account: Maya, with a sample Gmail, her main bot and its thread.
 * Seeds are written only when nothing has that id yet, so everything Maya
 * changes afterwards (a rename, a new bot, connecting her real Gmail under the
 * same id) is kept. Everyone else signs up and connects apps at runtime.
 */
const mayaGmail = accountFor(MAYA, "gmail", sampleConnection(MAYA, "gmail").identity, true);
if (!(await readAccount(mayaGmail.id))) await saveAccount(mayaGmail, sampleConnection(MAYA, "gmail").tokens);

const mayaMain = defineAgentInstance(bot, mainBotFor(MAYA, { name: "Chief", installations: [installationFor(mayaGmail)] }));
const mayaThread = createConversation(mayaMain, {
  id: "maya-main-thread",
  title: MAIN_THREAD.title,
  context: { conversationKey: MAIN_THREAD.key },
});

/** People, their bots, conversations, threads and skills live in `.data/foundry.json`. */
export const data = new FileFoundryDataAdapter({
  file: dataPath("foundry.json"),
  agents: [mayaMain],
  conversations: [mayaThread],
});

const mayaRoutes = gmailRoutes(mayaGmail.id);

export default defineApplication({
  name: "Bot crew",
  data,
  // Accounts come from your store (lib/accounts.ts); routes and bindings written
  // when someone connects an app are kept in .data/topology.json.
  services,
  routes: [mayaRoutes.in, mayaRoutes.out],
  bindings: [sendBinding(mayaMain.id, mayaGmail.id)],
  ...(requestAuthorization ? { requestAuthorization } : {}),
});

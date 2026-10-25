import { FileFoundryDataAdapter, createConversation, defineAgentInstance, defineApplication } from "glove-foundry";
import bot from "./agents/bot/agent.js";
import { xBot, xMentionsIn } from "./agents/bot/topology.js";
import { requestAuthorization } from "./lib/authorization.js";
import { dataPath } from "./lib/paths.js";
import { MAIN_THREAD, MAYA_MAIN_BOT } from "./lib/people.js";

/**
 * The demo account: Maya's main bot and its thread, seeded as instances of the
 * one bot definition. Seeds are written only when the data has no record with
 * that id, so everything Maya changes afterwards (a rename, a new bot, a
 * connected app) is kept. Everyone else's bots are created at runtime.
 */
const mayaMain = defineAgentInstance(bot, MAYA_MAIN_BOT);
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

export default defineApplication({
  name: "Bot crew",
  data,
  accounts: [xBot],
  routes: [xMentionsIn],
  bindings: [],
  ...(requestAuthorization ? { requestAuthorization } : {}),
});

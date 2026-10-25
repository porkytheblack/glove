import { composeAgent, defineAgent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";
import { botModel } from "../../lib/models.js";
import { OFFLINE_X_TOKEN } from "../../lib/x-api.js";
import gmail from "./apps/gmail.app.js";
import sheets from "./apps/sheets.app.js";
import tickets from "./apps/tickets.app.js";
import xApp from "./apps/x.app.js";
import memory from "./bot.memory.js";
import { computer } from "./computer.js";
import { mentionsFrom } from "./playbook.js";
import { botPrompt } from "./prompt.js";
import { botTools } from "./tools.js";

/**
 * Every bot, as one definition: what a bot can be. Which bot this is lives in
 * data: its name and job on the instance, the apps its owner connected, whether
 * it is its owner's main bot, and the conversation it is in. A person makes a
 * new bot by creating an instance, not by adding a file here.
 */
export default defineAgent({
  description: "A bot: an AI teammate with its own job and memory, working on a computer it shares with its owner's other bots",
  components: composeAgent(gmail, sheets, tickets, xApp, memory),

  model: botModel,
  systemPrompt: (_agent, ctx) => botPrompt(ctx),
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [memory],

  // take_job, connect_app, save_skill, request_sign_in, and the skill library.
  tools: (_agent, ctx) => botTools(ctx),
  workingEnvironment: computer,

  // Bots message each other by id over Glove Mesh. Their owner's workspace is
  // their team, so a bot only ever sees its owner's other bots.
  mesh: { waitMs: 60_000 },

  // Only the main bot takes tasks from X, and only its owner's posts.
  playbooks: (_agent, { agentInstance, installations }) =>
    agentInstance.context.primary === true
    && typeof agentInstance.context.xUserId === "string"
    && installations.some((item) => item.kind === "application" && item.id === xApp.id)
      ? [mentionsFrom(agentInstance.context.xUserId)]
      : [],

  // The credential boundary: Foundry asks for an operation, never sees the token.
  accountSessions: {
    identifier: "x-bot-token",
    withSession: (_request, use) => use({ token: process.env.X_BOT_TOKEN || OFFLINE_X_TOKEN }),
  },
});

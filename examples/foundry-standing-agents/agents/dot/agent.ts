import { composeAgent, defineAgent } from "glove-foundry";
import { currentDot } from "../../lib/dot.js";
import { FileStore } from "../../lib/file-store.js";
import { dotModel } from "../../lib/models.js";
import { OFFLINE_SLACK_TOKEN } from "../../lib/slack-api.js";
import slackApp from "./apps/slack.app.js";
import person from "./person.memory.js";
import { slackPlaybooks } from "./playbook.js";
import { dotPrompt } from "./prompt.js";
import { readOnly, research } from "./research.js";
import { dotTools } from "./tools.js";

/**
 * A dot: an always-on agent with a standing responsibility. One definition;
 * every dot is an instance whose context holds its responsibility, rules and
 * routing. Its conversations are its channels (app, Slack), sharing one memory.
 */
export default defineAgent({
  description: "Keeps one responsibility between conversations: reads its sources and acts within its rules",
  components: composeAgent(slackApp, person),

  model: dotModel,
  systemPrompt: async (_agent, ctx) => dotPrompt(await currentDot(ctx), ctx),
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [person],

  tools: (_agent, ctx) => dotTools(ctx),
  schedules: [research],
  playbooks: (_agent, ctx) => slackPlaybooks(ctx),
  // Heavy jobs go to the person's builder over the mesh. Runs on the dot's own
  // time only read, so they get no mesh tools.
  mesh: {
    peers: (_self, peer) => peer.definitionId === "builder",
    mount: (ctx) => !readOnly(ctx.request),
  },

  // The credential boundary: Foundry asks for an operation, never sees the token.
  accountSessions: {
    identifier: "slack-bot-token",
    withSession: (_request, use) => use({ token: process.env.SLACK_BOT_TOKEN || OFFLINE_SLACK_TOKEN }),
  },
});

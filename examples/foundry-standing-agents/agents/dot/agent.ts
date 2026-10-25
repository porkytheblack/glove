import { composeAgent, defineAgent } from "glove-foundry";
import { currentDot } from "../../lib/dot.js";
import { FileStore } from "../../lib/file-store.js";
import { callModel, dotModel } from "../../lib/models.js";
import { OFFLINE_SLACK_TOKEN } from "../../lib/slack-api.js";
import slackApp from "./apps/slack.app.js";
import { call, isCall } from "./call.js";
import person from "./person.memory.js";
import { slackPlaybooks } from "./playbook.js";
import { dotPrompt } from "./prompt.js";
import { readOnly, research } from "./research.js";
import { dotTools } from "./tools.js";
import { dotComputer } from "./workspace.js";

/**
 * What a dot can be. Every dot is an instance of this one definition: a
 * person's primary dot that they name, or a specialist an organisation sets
 * up. Its name, responsibilities, Custom Rules and routing are its data
 * (lib/dot.ts). Its conversations are its channels (the app, Slack, a call),
 * sharing one memory.
 */
export default defineAgent({
  description: "An always-on agent that works on its person's responsibilities and acts within their rules",
  components: composeAgent(slackApp, person),

  model: (_agent, ctx) => (isCall(ctx) ? callModel() : dotModel()),
  systemPrompt: async (_agent, ctx) => dotPrompt(await currentDot(ctx), ctx, isCall(ctx)),
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [person],

  tools: (_agent, ctx) => dotTools(ctx),
  schedules: [research],
  playbooks: (_agent, ctx) => slackPlaybooks(ctx),

  // Its own computer, but not on research runs: those only read.
  workingEnvironment: (_agent, ctx) => (readOnly(ctx.request) ? undefined : dotComputer),

  // Coding jobs start on the person's builder over the mesh. Research runs get
  // no mesh tools.
  mesh: {
    peers: (_self, peer) => peer.definitionId === "builder",
    mount: (ctx) => !readOnly(ctx.request),
  },

  // The credential boundary: Foundry asks for an operation, never sees the token.
  accountSessions: {
    identifier: "slack-bot-token",
    withSession: (_request, use) => use({ token: process.env.SLACK_BOT_TOKEN || OFFLINE_SLACK_TOKEN }),
  },

  run: (agent, ctx) => (isCall(ctx) ? call(agent, ctx) : ctx.defaultRun()),
});

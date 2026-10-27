import { composeAgent, defineAgent, defineRepl } from "glove-foundry";
import { JsSession } from "glove-js";
import { accountSessions as connectedAccounts } from "../../lib/accounts.js";
import { currentDot } from "../../lib/dot.js";
import { FileStore } from "../../lib/file-store.js";
import { callModel, dotModel } from "../../lib/models.js";
import { monitored } from "../../lib/monitor.js";
import { OFFLINE_SLACK_TOKEN } from "../../lib/slack-api.js";
import gmailApp from "./apps/gmail.app.js";
import slackApp from "./apps/slack.app.js";
import { call, isCall } from "./call.js";
import person from "./person.memory.js";
import { dotPlaybooks } from "./playbook.js";
import { dotPrompt } from "./prompt.js";
import { readOnly, research } from "./research.js";
import { configureDot, dotTools, reviewedTools } from "./tools.js";
import { slackBot } from "./topology.js";
import { dotComputer } from "./workspace.js";

/**
 * What a dot can be. Every dot is an instance of this one definition: a
 * person's primary dot that they name, or a specialist an organisation sets
 * up. Its name, responsibilities, Custom Rules and routing are its data
 * (lib/dot.ts). Its conversations are its channels (the app, Slack, a call),
 * sharing one memory. It works in the apps its person connects (Gmail here).
 */
export default defineAgent({
  description: "An always-on agent that works on its person's responsibilities and acts within their rules",
  components: composeAgent(gmailApp, slackApp, person),

  model: (_agent, ctx) => (isCall(ctx) ? callModel() : dotModel(ctx.agentInstance.workspaceId)),
  systemPrompt: async (_agent, ctx) => dotPrompt(await currentDot(ctx), ctx, isCall(ctx)),
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [person],

  tools: (_agent, ctx) => dotTools(ctx),
  schedules: [research],
  playbooks: (_agent, ctx) => dotPlaybooks(ctx),

  // The connected apps' reads as functions (gmail.search_threads,
  // gmail.get_thread): research reads the mailbox in code. Anything that
  // writes stays a tool.
  repl: () => defineRepl({
    language: "javascript",
    session: JsSession.create(),
    mount: { discovery: "auto" },
    programmaticTools: { select: ({ apps }) => apps.flatMap((app) => app.tools.filter((tool) => tool.readOnly)), keepDirect: false },
  }),
  // Gmail's send under auto-review, and follow-ups; gone on read-only runs.
  configure: (agent, ctx) => configureDot(agent, ctx),

  // Its own computer, but not on read-only runs.
  workingEnvironment: async (_agent, ctx) => (readOnly(ctx.request, await currentDot(ctx)) ? undefined : dotComputer),

  // Coding jobs start on the person's builder over the mesh. Research runs get
  // no mesh tools; a paused dot loses them in configureDot.
  mesh: {
    peers: (_self, peer) => peer.definitionId === "builder",
    mount: (ctx) => !readOnly(ctx.request),
  },

  // The credential boundary: Foundry asks for an operation, never sees the
  // token. The Slack bot user is the app's; every other account is one a
  // person connected (lib/accounts.ts).
  accountSessions: {
    identifier: "dot-accounts",
    withSession: (request, use) => request.accountId === slackBot.id
      ? use({ token: process.env.SLACK_BOT_TOKEN || OFFLINE_SLACK_TOKEN })
      : connectedAccounts.withSession(request, use),
  },

  // The monitor pauses the dot after hand-offs and denials in a row.
  run: (agent, ctx) => (isCall(ctx) ? call(agent, ctx) : monitored(agent, ctx, reviewedTools(), () => ctx.defaultRun())),
});

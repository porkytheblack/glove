import { composeAgent, defineAgent, defineRepl } from "glove-foundry";
import { JsSession } from "glove-js";
import { accountSessions } from "../../lib/accounts.js";
import { FileStore } from "../../lib/file-store.js";
import { botModel } from "../../lib/models.js";
import gmailApp from "./apps/gmail.app.js";
import linearApp from "./apps/linear.app.js";
import memory from "./bot.memory.js";
import { computer } from "./computer.js";
import type { EventRoutine } from "../../lib/people.js";
import { newMailFor } from "./playbook.js";
import { botPrompt } from "./prompt.js";
import { botTools } from "./tools.js";

/**
 * Every bot, as one definition: what a bot can be. The bots are siblings, and
 * which bot this is lives in data: its name and job on the instance, the
 * accounts its owner connected, its routines, and the conversation it is in.
 * A bot runs when its person writes to it, when it is @-mentioned in a group
 * chat, when a sibling hands it work, and when one of its routines fires. A
 * person makes a new bot by creating an instance, not by adding a file here.
 */
export default defineAgent({
  description: "A bot: an AI teammate with its own job and memory, working in its owner's apps and on a computer it shares with their other bots",
  // The apps a bot may have. Each one is installed per bot with the owner's account.
  components: composeAgent(gmailApp, linearApp, memory),

  model: botModel,
  systemPrompt: (_agent, ctx) => botPrompt(ctx),
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [memory],

  // take_job, connect_app, save_skill, add_routine, request_sign_in, and the skill library.
  tools: (_agent, ctx) => botTools(ctx),
  workingEnvironment: computer,

  // The connected apps' reads as functions, one group per app:
  // gmail.search_threads, linear.list_issues. A bot reads across apps in one
  // program instead of carrying every app's tools in context. Anything that
  // writes stays a direct tool, so a person can see and approve it.
  repl: () => defineRepl({
    language: "javascript",
    session: JsSession.create(),
    mount: { discovery: "auto" },
    programmaticTools: { select: ({ apps }) => apps.flatMap((app) => app.tools.filter((tool) => tool.readOnly)), keepDirect: false },
  }),

  // Bots message each other by id over Glove Mesh. Their owner's workspace is
  // their team, so a bot only ever sees its owner's other bots.
  mesh: { waitMs: 60_000 },

  // Routines after an event: new mail reaches the bots whose routines say so,
  // once Gmail is connected. Routines on a schedule are the bot's own
  // Foundry schedules (glove_foundry_schedule).
  playbooks: (_agent, { agentInstance, installations }) => {
    const mail = installations.find((item) => item.kind === "application" && item.id === gmailApp.id);
    const routine = ((agentInstance.context.routines ?? []) as ReadonlyArray<EventRoutine>).find((item) => item.on === "new-mail");
    return mail?.accountId && routine ? [newMailFor(mail.accountId, routine)] : [];
  },

  // The credential boundary: apps, the Gmail watch and every send ask for an
  // operation on an account and never see its token.
  accountSessions,
});

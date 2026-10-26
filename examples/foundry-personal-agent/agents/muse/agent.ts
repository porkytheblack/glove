import { composeAgent, defineAgent, defineRepl } from "glove-foundry";
import { JsSession } from "glove-js";
import { accountSessions } from "../../lib/accounts.js";
import { FileStore } from "../../lib/file-store.js";
import { museModel } from "../../lib/models.js";
import calendarApp from "./apps/calendar.app.js";
import gmailApp from "./apps/gmail.app.js";
import whatsappApp from "./apps/whatsapp.app.js";
import memory from "./muse.memory.js";
import { musePlaybooks } from "./playbook.js";
import { musePrompt } from "./prompt.js";
import activity from "./subscribers/activity.subscriber.js";
import { keepToAccess, museTools } from "./tools.js";
import { mountMuseBrowser } from "./browser.js";

/**
 * A personal agent, like Meta's Muse: one per person, reached in the app and
 * on WhatsApp, working across the apps they connect and the web, in a browser
 * of its own on Kuiper. Who it works for, what they connected and how much it
 * may do there, which sites it may reach and which browser is theirs are all
 * data on the instance.
 *
 * This file only assembles. What each part does lives beside it.
 */
export default defineAgent({
  description: "Does the work across one person's apps and the web, in its own browser, with their say-so",
  components: composeAgent(gmailApp, calendarApp, whatsappApp, memory, activity),

  model: museModel,
  systemPrompt: (_agent, ctx) => musePrompt(ctx),
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [memory],
  // The date, read fresh each turn rather than baked into the prompt.
  contextProviders: () => [() => `Today is ${new Date().toDateString()}.`],

  // buy (a one-time card, typed in by host code) and request_access (the Sentinel's question).
  tools: (_agent, ctx) => museTools(ctx),
  // The connected apps' reads as functions; anything that writes stays a tool.
  repl: () => defineRepl({
    language: "javascript",
    session: JsSession.create(),
    mount: { discovery: "auto" },
    programmaticTools: { select: ({ apps }) => apps.flatMap((app) => app.tools.filter((tool) => tool.readOnly)), keepDirect: false },
  }),
  // WhatsApp from its person; new mail.
  playbooks: (_agent, ctx) => musePlaybooks(ctx),
  // The access each app was given holds for Foundry's send tools too; and its
  // browser on Kuiper, with the Sentinel as the browser's guard.
  configure: (agent, ctx) => {
    keepToAccess(agent, ctx);
    mountMuseBrowser(agent, ctx);
  },
  // Its log, written from Foundry's side of every run.
  subscribers: [activity],

  // The credential boundary: apps, the Gmail watch and every send ask for an
  // operation on an account and never see its token.
  accountSessions,
});

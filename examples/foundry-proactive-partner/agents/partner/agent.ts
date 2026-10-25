import { useReadSkill } from "glove-core";
import { composeAgent, defineAgent, defineRepl } from "glove-foundry";
import { JsSession } from "glove-js";
import { accountSessions } from "../../lib/accounts.js";
import { FileStore } from "../../lib/file-store.js";
import { callModel, partnerModel } from "../../lib/models.js";
import { loadSkills } from "../../lib/skills.js";
import { actionTools } from "./actions.js";
import calendarApp from "./apps/calendar.app.js";
import gmailApp from "./apps/gmail.app.js";
import { call, isCall } from "./call.js";
import { notifyTool } from "./notify.js";
import personal from "./personal.memory.js";
import { newMailFor } from "./playbook.js";
import { partnerPrompt } from "./prompt.js";
import { partnerSchedules } from "./schedules.js";
import { guardSends } from "./send.js";

/**
 * A proactive partner. One instance per person and one thread: what they say,
 * the morning brief, every check-in and new mail land in the same conversation.
 *
 * This file only assembles. What each part does lives beside it.
 */
export default defineAgent({
  description: "Looks after one person's inbox, calendar and errands, and reaches out before they ask",
  // The apps a partner may have, each installed with the person's account.
  components: composeAgent(gmailApp, calendarApp, personal),

  model: (_agent, context) => (isCall(context) ? callModel() : partnerModel(context.agentInstance.workspaceId)),
  systemPrompt: (_agent, context) => partnerPrompt(context, isCall(context)),
  store: ({ conversationId }) => FileStore.open(conversationId),
  memory: [personal],

  tools: () => [...actionTools(), notifyTool],
  schedules: (_agent, { agentInstance }) => partnerSchedules(agentInstance.context),
  // New mail comes in as it arrives, once Gmail is connected.
  playbooks: (_agent, { installations }) => {
    const mail = installations.find((item) => item.kind === "application" && item.id === gmailApp.id);
    return mail?.accountId ? [newMailFor(mail.accountId)] : [];
  },

  // The connected apps as functions: gmail.search_threads, calendar.list_events.
  // A brief reads both in one program. Anything that asks first stays a tool.
  repl: () => defineRepl({
    language: "javascript",
    session: JsSession.create(),
    mount: { discovery: "auto" },
    programmaticTools: { select: ({ apps }) => apps.flatMap((app) => app.tools), keepDirect: false },
  }),
  configure: async (agent, ctx) => {
    useReadSkill(agent, await loadSkills());
    // Gmail's send, behind the guard.
    guardSends(agent, ctx);
  },

  // Long jobs go to its computer, another agent in the person's workspace,
  // over Glove Mesh. The computer is data too (lib/onboarding.ts).
  mesh: true,

  // The credential boundary: apps, the Gmail watch and every send ask for an
  // operation on an account and never see its token.
  accountSessions,

  run: (agent, context) => (isCall(context) ? call(agent, context) : context.defaultRun()),
});

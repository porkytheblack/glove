import { composePlaybook, type AgentAssemblyContext } from "glove-foundry";
import { gmailRoutes } from "../../lib/connect.js";
import { Dot, storedInstance } from "../../lib/dot.js";
import answer from "./actions/answer.action.js";
import readMail from "./actions/read-mail.action.js";
import gmailApp from "./apps/gmail.app.js";
import slackApp from "./apps/slack.app.js";
import mailReceived from "./events/mail-received.event.js";
import message from "./events/message.event.js";
import fromOwner from "./predicates/from-owner.predicate.js";
import { slackMessagesIn } from "./topology.js";
import gmail from "./transmissions/gmail.transmission.js";
import slackMessages from "./transmissions/slack-messages.transmission.js";

/** When the owner DMs or mentions the bot, the message is for their dot. */
export function messagesFrom(slackUserId: string) {
  return composePlaybook({
    name: "slack-messages",
    transmission: slackMessages,
    match: {
      event: message,
      routes: [slackMessagesIn],
      predicate: { definition: fromOwner, parameters: { slackUserId } },
    },
    directives: [{
      action: answer,
      instruction:
        "Answer with post_to_slack in the same channel. For a mention in a channel, answer in its thread (thread_ts, or ts when there is none). Use what you know from the app too.",
    }],
    applications: [slackApp],
  });
}

/**
 * New mail in the mailbox the dot works from. Mail comes from anyone, so these
 * runs only read (research.ts): the dot reads it, keeps notes and may bring
 * one suggestion to the app, where progress goes.
 */
export function newMailFor(accountId: string) {
  return composePlaybook({
    name: "new-mail",
    transmission: gmail,
    match: { event: mailReceived, routes: [gmailRoutes(accountId).in] },
    directives: [{
      action: readMail,
      instruction:
        "New mail in the mailbox you watch. If it bears on a responsibility, keep a note with keep_note. Bring at most one suggestion with suggest; otherwise say in one line what it is.",
    }],
    applications: [gmailApp],
  });
}

/** Slack messages from the owner, once Slack is connected; new mail, once Gmail is. */
export async function dotPlaybooks(ctx: AgentAssemblyContext) {
  const instance = await storedInstance(ctx);
  const { slackUserId } = Dot.parse(instance.context);
  const installed = (app: { readonly id: string }) =>
    instance.installations.find((item) => item.kind === "application" && item.id === app.id);
  const mail = installed(gmailApp);
  return [
    ...(slackUserId && installed(slackApp) ? [messagesFrom(slackUserId)] : []),
    ...(mail?.accountId ? [newMailFor(mail.accountId)] : []),
  ];
}

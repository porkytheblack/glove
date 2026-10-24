import { composePlaybook, type AgentAssemblyContext } from "glove-foundry";
import { Dot, storedInstance } from "../../lib/dot.js";
import answer from "./actions/answer.action.js";
import slackApp from "./apps/slack.app.js";
import message from "./events/message.event.js";
import fromOwner from "./predicates/from-owner.predicate.js";
import { slackMessagesIn } from "./topology.js";
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

/** The Slack playbook, once the owner has connected Slack and the app is installed. */
export async function slackPlaybooks(ctx: AgentAssemblyContext) {
  const instance = await storedInstance(ctx);
  const { slackUserId } = Dot.parse(instance.context);
  const installed = instance.installations.some((item) => item.kind === "application" && item.id === slackApp.id);
  return slackUserId && installed ? [messagesFrom(slackUserId)] : [];
}

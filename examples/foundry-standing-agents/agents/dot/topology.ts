import { defineAccount, defineInboundRoute } from "glove-foundry";
import slackMessages from "./transmissions/slack-messages.transmission.js";

/** The Slack app's bot user: people DM it or mention it, and it posts as itself. */
export const slackBot = defineAccount({
  id: "slack-bot",
  transmission: slackMessages,
  externalAccountId: process.env.SLACK_TEAM_ID ?? "T0000000000",
  label: "The dots' bot user in Slack",
  accessRef: "env://SLACK_BOT_TOKEN", // only accountSessions reads it
  metadata: { botUserId: process.env.SLACK_BOT_USER_ID ?? "U0000000BOT" },
});

export const slackMessagesIn = defineInboundRoute({
  id: "slack-messages",
  transmission: slackMessages,
  account: slackBot,
  visibility: "workspace",
  enabled: true,
  config: {
    teamId: process.env.SLACK_TEAM_ID ?? "T0000000000",
    appId: process.env.SLACK_APP_ID ?? "A0000000000",
  },
});

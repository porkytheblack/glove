import { defineAccount, defineInboundRoute } from "glove-foundry";
import xMentions from "./transmissions/x-mentions.transmission.js";

/** The bot's own X account: people tag it, and it replies as itself. */
export const xBot = defineAccount({
  id: "x-bot",
  transmission: xMentions,
  externalAccountId: process.env.X_BOT_USER_ID ?? "1000",
  label: "The crew's bot account on X",
  accessRef: "env://X_BOT_TOKEN", // only accountSessions reads it
  metadata: { handle: process.env.X_BOT_HANDLE ?? "crewbot" },
});

export const xMentionsIn = defineInboundRoute({
  id: "x-mentions",
  transmission: xMentions,
  account: xBot,
  visibility: "workspace",
  enabled: true,
  config: { botUserId: process.env.X_BOT_USER_ID ?? "1000" },
});

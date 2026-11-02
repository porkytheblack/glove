import { defineTransmissionEvent } from "glove-foundry";

export default defineTransmissionEvent({
  direction: "inbound",
  description: "A Slack DM to the bot, or a mention of it in a channel.",
});

import { defineTransmissionEvent } from "glove-foundry";

export default defineTransmissionEvent({
  direction: "inbound",
  description: "Someone tagged the bot in a post on X.",
});

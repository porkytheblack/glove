import { defineTransmissionEvent } from "glove-foundry";

export default defineTransmissionEvent({
  direction: "inbound",
  description: "A support message entered the agent workforce.",
});

import { defineTransmissionEvent } from "glove-foundry";

export default defineTransmissionEvent({
  direction: "outbound",
  description: "Hermes sent a response to a communication channel.",
});

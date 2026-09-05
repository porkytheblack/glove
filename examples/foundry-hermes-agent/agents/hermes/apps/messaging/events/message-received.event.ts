import { defineTransmissionEvent } from "glove-foundry";

export default defineTransmissionEvent({
  direction: "inbound",
  description: "A message arrived from an installed communication channel.",
});

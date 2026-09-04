import { defineTransmissionEvent } from "glove-foundry";

export default defineTransmissionEvent({
  direction: "inbound",
  description: "A file was delivered into Hermes' working environment.",
});

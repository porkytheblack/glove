import { defineTransmissionEvent } from "glove-foundry";

/** A traveller sent the concierge a message from a chat app. */
export default defineTransmissionEvent({
  direction: "inbound",
  description: "A traveller message arrived from a chat transport.",
});

import { defineTransmissionEvent } from "glove-foundry";

/** The concierge replied into the same chat thread. */
export default defineTransmissionEvent({
  direction: "outbound",
  description: "A concierge reply was delivered back to the traveller.",
});

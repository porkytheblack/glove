import { defineTransmissionEvent } from "glove-foundry";

/** A new message in the person's inbox. */
export default defineTransmissionEvent({ direction: "inbound" });

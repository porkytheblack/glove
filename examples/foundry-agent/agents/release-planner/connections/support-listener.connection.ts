import { Effect } from "effect";
import { defineConnection } from "glove-foundry";
import supportTransmission from "../transmissions/support.transmission.js";

const supportListener = defineConnection({
  description: "Long-lived inbound provider connection",
  transmissions: [supportTransmission],
  connect: (context) => Effect.gen(function* () {
    // Open the provider socket/webhook worker here, then call context.receive(...).
    // Credential acquisition and refresh remain inside the user's adapter.
    yield* context.ready();
    yield* Effect.never;
  }),
});

export default supportListener;

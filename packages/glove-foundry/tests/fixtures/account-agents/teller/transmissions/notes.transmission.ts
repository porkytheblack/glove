import { Effect, Schema } from "effect";
import { defineTransmission } from "../../../../../src/index.js";
import note from "../events/note.event.js";

export default defineTransmission({
  name: "Notes",
  description: "Fixture transport with an account",
  account: { required: true, metadata: Schema.Struct({ label: Schema.String }) },
  events: [note],
  inbound: {
    config: Schema.Struct({}),
    event: Schema.Struct({ text: Schema.String }),
    classify: () => Effect.succeed(note),
  },
});

import { Effect, Schema } from "effect";
import { defineTransmission } from "glove-foundry";
import received from "../events/file-received.event.js";

const fileDrop = defineTransmission({
  name: "File drop",
  description: "Provider-neutral file arrival into an agent workspace",
  events: [received],
  inbound: {
    config: Schema.Struct({ mountPoint: Schema.String }),
    event: Schema.Struct({
      name: Schema.String,
      mediaType: Schema.String,
      content: Schema.String,
    }),
    classify: () => Effect.succeed(received),
  },
});

export default fileDrop;

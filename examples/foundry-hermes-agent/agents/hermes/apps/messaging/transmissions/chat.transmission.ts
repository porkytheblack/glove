import { Effect, Schema } from "effect";
import { defineTransmission } from "glove-foundry";
import { recordDelivery } from "../../../../../lib/deliveries.js";
import addressed from "../predicates/addressed.predicate.js";
import received from "../events/message-received.event.js";
import sent from "../events/message-sent.event.js";

export const sendMessage = {
  id: "messages:send",
  description: "Send a message through an installed channel",
  account: "required",
  effect: "write",
} as const;

const chat = defineTransmission({
  name: "Channel messages",
  description: "Provider-neutral inbound and outbound message delivery",
  account: {
    required: true,
    metadata: Schema.Struct({ provider: Schema.String, address: Schema.String }),
  },
  capabilities: [sendMessage],
  events: [received, sent],
  inbound: {
    config: Schema.Struct({ provider: Schema.String, channel: Schema.String }),
    event: Schema.Struct({ sender: Schema.String, thread: Schema.String, text: Schema.String }),
    classify: () => Effect.succeed(received),
    predicates: [addressed],
  },
  outbound: {
    config: Schema.Struct({ provider: Schema.String, channel: Schema.String }),
    input: Schema.Struct({ thread: Schema.String, text: Schema.String }),
    output: Schema.Struct({ externalMessageId: Schema.String }),
    adapter: {
      deliver: (input, context) => Effect.sync(() => {
        const delivered = recordDelivery(context.route.id, input.text);
        return { externalMessageId: delivered.id };
      }),
    },
  },
});

export default chat;

import { Effect, Schema } from "effect";
import { defineTransmission } from "glove-foundry";
import messageIncludes from "../predicates/message-includes.predicate.js";
import messageReceived from "../events/message-received.event.js";
import messageReply from "../events/message-reply.event.js";

export const supportReply = {
  id: "support:reply",
  description: "Reply to a support conversation",
  account: "required",
  effect: "write",
} as const;

const supportTransmission = defineTransmission({
  name: "Support",
  description: "Provider-neutral support message transport",
  account: {
    required: true,
    metadata: Schema.Struct({ address: Schema.String, workspace: Schema.String }),
  },
  capabilities: [supportReply],
  events: [messageReceived, messageReply],
  inbound: {
    config: Schema.Struct({ channel: Schema.String }),
    event: Schema.Struct({ conversationId: Schema.String, message: Schema.String }),
    classify: () => Effect.succeed(messageReceived),
    predicates: [messageIncludes],
  },
  outbound: {
    config: Schema.Struct({ channel: Schema.String }),
    input: Schema.Struct({ conversationId: Schema.String, message: Schema.String }),
    output: Schema.Struct({ externalMessageId: Schema.String }),
    adapter: {
      deliver: (input) => Effect.succeed({
        externalMessageId: `example:${input.conversationId}`,
      }),
    },
  },
});

export default supportTransmission;

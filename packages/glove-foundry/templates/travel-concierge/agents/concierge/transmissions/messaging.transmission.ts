import { Effect, Schema } from "effect";
import { defineTransmission } from "glove-foundry";
import mentionsTrip from "../predicates/mentions-trip.predicate.js";
import messageReceived from "../events/message-received.event.js";
import messageSent from "../events/message-sent.event.js";

/**
 * A transmission is the *shape* of an external transport, not a vendor SDK.
 * Telegram and WhatsApp both look like "a chat with threads", so one
 * transmission covers both and `config.provider` picks which.
 *
 * Foundry never stores credentials. `account.metadata` holds safe descriptive
 * fields; the secret itself lives behind `accessRef` in an adapter you own.
 */
export const sendMessage = {
  id: "messaging:send",
  description: "Send a message into a traveller's chat thread",
  account: "required",
  effect: "write",
} as const;

/** Swap this for a real Bot API call. See README, "Connecting a real chat app". */
function deliver(input: { readonly threadId: string; readonly text: string }, provider: string) {
  process.stdout.write(`[${provider}] -> ${input.threadId}: ${input.text}\n`);
  return Effect.succeed({ externalMessageId: `${provider}:${input.threadId}:${Date.now()}` });
}

const messaging = defineTransmission({
  name: "Messaging",
  description: "Chat transport for Telegram, WhatsApp, or any threaded messenger",
  account: {
    required: true,
    metadata: Schema.Struct({
      handle: Schema.String,
      provider: Schema.Literal("telegram", "whatsapp"),
    }),
  },
  capabilities: [sendMessage],
  events: [messageReceived, messageSent],
  inbound: {
    config: Schema.Struct({ provider: Schema.Literal("telegram", "whatsapp") }),
    event: Schema.Struct({ threadId: Schema.String, text: Schema.String }),
    classify: () => Effect.succeed(messageReceived),
    predicates: [mentionsTrip],
  },
  outbound: {
    config: Schema.Struct({ provider: Schema.Literal("telegram", "whatsapp") }),
    input: Schema.Struct({ threadId: Schema.String, text: Schema.String }),
    output: Schema.Struct({ externalMessageId: Schema.String }),
    adapter: {
      deliver: (input, context) =>
        deliver(input, (context.route.config as { provider?: string }).provider ?? "telegram"),
    },
  },
});

export default messaging;

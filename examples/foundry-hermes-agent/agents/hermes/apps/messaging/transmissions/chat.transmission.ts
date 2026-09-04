import { Effect, Schema } from "effect";
import { defineTransmission } from "glove-foundry";
import { recordDelivery } from "../../../../../lib/deliveries.js";
import type { HermesMessengerSession } from "../../../../../lib/account-sessions.js";
import { telegramCall, type TelegramMessage } from "../../../../../lib/telegram.js";
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
      deliver: (input, context) => {
        const provider = context.route.config && typeof context.route.config === "object" && "provider" in context.route.config
          ? String(context.route.config.provider)
          : "local";
        if (provider === "local") {
          return Effect.sync(() => {
            const delivered = recordDelivery(context.route.id, input.text);
            return { externalMessageId: delivered.id };
          });
        }
        if (provider !== "telegram") {
          return Effect.die(new Error(`Unsupported chat provider "${provider}".`));
        }
        if (!context.withAccountSession) {
          return Effect.die(new Error("Telegram delivery requires an account session adapter."));
        }
        return context.withAccountSession("telegram:send-message", (session) => Effect.tryPromise({
          try: async () => {
            const delivered = await telegramCall<TelegramMessage>(
              session as HermesMessengerSession,
              "sendMessage",
              { chat_id: input.thread, text: input.text },
            );
            return { externalMessageId: String(delivered.message_id) };
          },
          catch: (cause) => cause,
        })).pipe(Effect.orDie);
      },
    },
  },
});

export default chat;

import { Effect, Schema } from "effect";
import { defineTransmission } from "glove-foundry";
import type { WhatsAppSession } from "../../../lib/accounts.js";
import { record } from "../../../lib/ledger.js";
import { WhatsAppWebhook, sendText, textMessageIn } from "../../../lib/whatsapp.js";
import message from "../events/message.event.js";
import fromPerson from "../predicates/from-person.predicate.js";

/** What a binding grants for this transmission: answering one person on WhatsApp. */
export const answerPerson = {
  id: "whatsapp:answer",
  description: "Send a WhatsApp message to the person a route is for",
  account: "required",
  effect: "write",
} as const;

/**
 * WhatsApp, in and out, through Muse's business number. In: a person's text
 * message, checked against the route's number. Out: a text to the one person
 * the route is for. The route fixes the recipient, so Muse can answer its
 * person on WhatsApp but cannot message anyone else from there.
 */
export default defineTransmission({
  name: "WhatsApp",
  description: "Messages from people to Muse's WhatsApp number, and Muse's answers to each of them",
  account: { required: true, metadata: Schema.Struct({ phoneNumberId: Schema.String }) },
  capabilities: [answerPerson],
  events: [message],
  inbound: {
    config: Schema.Struct({ phoneNumberId: Schema.String }),
    event: Schema.Struct({
      messageId: Schema.String,
      from: Schema.String,
      name: Schema.String,
      text: Schema.String,
      sentAt: Schema.String,
    }),
    adapter: {
      // The delivery must be for this route's number and carry a text.
      authenticate: (raw, { route }) =>
        Schema.decodeUnknown(WhatsAppWebhook)(raw).pipe(
          Effect.map((hook) => textMessageIn(hook)?.phoneNumberId === route.config.phoneNumberId),
          Effect.orElseSucceed(() => false),
        ),
      normalize: (raw) =>
        Schema.decodeUnknown(WhatsAppWebhook)(raw).pipe(
          Effect.flatMap((hook) => {
            const text = textMessageIn(hook);
            return text ? Effect.succeed({ messageId: text.messageId, from: text.from, name: text.name, text: text.text, sentAt: text.sentAt }) : Effect.fail(new Error("No text message in this delivery."));
          }),
          Effect.orDie,
        ),
    },
    classify: () => Effect.succeed(message),
    predicates: [fromPerson],
  },
  outbound: {
    config: Schema.Struct({
      /** The person this route answers, by their WhatsApp number. */
      to: Schema.String,
    }),
    input: Schema.Struct({ text: Schema.String.pipe(Schema.maxLength(4096)) }),
    output: Schema.Struct({ messageId: Schema.String }),
    observe: ({ text }) => ({ characters: text.length }),
    adapter: {
      deliver: ({ text }, { route, account, withAccountSession, signal }) => {
        if (!withAccountSession || !account) return Effect.die(new Error("WhatsApp needs Muse's number as the route's account."));
        const phoneNumberId = String(account.metadata.phoneNumberId);
        return withAccountSession("whatsapp:send", (session) => Effect.tryPromise({
          try: async () => {
            const { token, offline } = session as WhatsAppSession;
            const to = String(route.config.to);
            if (!offline) return sendText(token, { phoneNumberId, to, text }, signal);
            const messageId = `offline-wa-${Date.now().toString(36)}`;
            await record({ kind: "whatsapp", to, text, messageId });
            return { messageId };
          },
          catch: (cause) => cause,
        })).pipe(Effect.orDie);
      },
    },
  },
});

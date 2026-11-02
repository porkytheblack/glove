import { Effect, Schema } from "effect";
import { defineTransmission } from "glove-foundry";
import type { AccountSession } from "../../../lib/accounts.js";
import { record } from "../../../lib/ledger.js";
import { sendMail } from "../../../lib/google.js";
import mailReceived from "../events/mail-received.event.js";

/** What a binding grants for this transmission: sending as the person. */
export const sendAsOwner = {
  id: "gmail:send",
  description: "Send email from the person's Gmail",
  account: "required",
  effect: "write",
} as const;

/**
 * A person's Gmail, in and out. In: each new inbox message, which the
 * gmail-watch connection reads as Gmail announces it. Out: one email, sent
 * from the person's address. Foundry delivers it in its own process, inside
 * the account session, after the person approves the exact message; the agent
 * that asked never sees the token.
 */
export default defineTransmission({
  name: "Gmail",
  description: "New mail in a person's inbox, and email sent from their address",
  account: { required: true, metadata: Schema.Struct({ email: Schema.String }) },
  capabilities: [sendAsOwner],
  events: [mailReceived],
  inbound: {
    config: Schema.Struct({
      /** The Gmail label to watch. */
      label: Schema.String,
      /** Join this conversation instead of opening one per email thread. */
      conversation: Schema.optional(Schema.String),
    }),
    event: Schema.Struct({
      messageId: Schema.String,
      threadId: Schema.String,
      from: Schema.String,
      subject: Schema.String,
      snippet: Schema.String,
      receivedAt: Schema.String,
      rfcMessageId: Schema.String,
    }),
    classify: () => Effect.succeed(mailReceived),
  },
  outbound: {
    config: Schema.Struct({}),
    input: Schema.Struct({
      to: Schema.String,
      subject: Schema.String,
      body: Schema.String,
      /** Reply in this Gmail thread. */
      threadId: Schema.optional(Schema.String),
      /** The rfcMessageId of the message being answered. */
      inReplyTo: Schema.optional(Schema.String),
    }),
    output: Schema.Struct({ messageId: Schema.String, threadId: Schema.String }),
    requiresPermission: true,
    // Retained in traces instead of the body.
    observe: ({ to, subject, body }) => ({ to, subject, characters: body.length }),
    adapter: {
      deliver: (mail, { withAccountSession, signal }) => {
        if (!withAccountSession) return Effect.die(new Error("Sending needs the route's account and the agent's accountSessions."));
        return withAccountSession("gmail:send", (session) => Effect.tryPromise({
          try: async () => {
            const { accessToken, account } = session as AccountSession;
            if (!account.offline) return sendMail(accessToken, mail, signal);
            // A sample account writes to the ledger instead of Gmail.
            const messageId = `offline-${Date.now().toString(36)}`;
            await record({ kind: "email", from: account.metadata.email, ...mail, messageId });
            return { messageId, threadId: mail.threadId ?? messageId };
          },
          catch: (cause) => cause,
        })).pipe(Effect.orDie);
      },
    },
  },
});

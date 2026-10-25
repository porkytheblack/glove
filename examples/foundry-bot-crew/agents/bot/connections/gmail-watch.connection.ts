import { Effect } from "effect";
import { defineConnection } from "glove-foundry";
import type { AccountSession } from "../../../lib/accounts.js";
import { watchMailbox } from "../../../lib/google.js";
import gmail from "../transmissions/gmail.transmission.js";

/**
 * Watches one person's inbox. Foundry runs one per account, and only while
 * an agent has the Gmail app installed with that account and a playbook that
 * wants its mail; uninstalling the app or connecting another account stops or
 * starts it. Each new message becomes one Gmail event, claimed once by its
 * Gmail id however many times Google announces it.
 */
export default defineConnection({
  description: "New mail from one person's Gmail, as Gmail announces it",
  transmissions: [gmail],
  connect: (context) => Effect.gen(function* () {
    const { account, withAccountSession, routes } = context;
    const route = routes[0];
    if (!account || !withAccountSession || !route) {
      return yield* Effect.fail(new Error("The Gmail watch needs an inbound route with an account, and the agent's accountSessions."));
    }
    const session = () => Effect.runPromise(withAccountSession("gmail:watch", (value) => Effect.succeed(value as AccountSession)));
    if ((yield* Effect.promise(session)).account.offline) {
      // A sample account has no Gmail to watch; its mail arrives through the route.
      yield* context.ready();
      return yield* Effect.never;
    }
    const conversation = typeof route.config.conversation === "string" ? route.config.conversation : undefined;
    yield* Effect.tryPromise({
      try: () => watchMailbox({
        email: typeof account.metadata.email === "string" ? account.metadata.email : account.externalAccountId,
        label: typeof route.config.label === "string" ? route.config.label : "INBOX",
        token: async () => (await session()).accessToken,
        ready: () => Effect.runPromise(context.ready()),
        onMail: (mail) => Effect.runPromise(context.receive({
          route,
          eventId: mail.messageId,
          threadKey: mail.threadId,
          ...(conversation ? { conversationKey: conversation, conversationScope: "agent" as const } : {}),
          raw: mail,
        })),
        signal: context.signal,
      }),
      catch: (cause) => cause,
    });
  }),
});

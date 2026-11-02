import { Effect } from "effect";
import { z } from "zod";
import { defineApp } from "../../../../../src/index.js";
import notes from "../transmissions/notes.transmission.js";

// Reports the session the account adapter opened for this installation's account.
export default defineApp({
  description: "Fixture app that reads its account session",
  inbound: [notes],
  install: ({ accountId, withAccountSession }) =>
    Effect.succeed({
      tools: [{
        name: "whoami",
        description: "Say which account session this install got",
        inputSchema: z.object({}),
        async do() {
          if (!withAccountSession) return { status: "success" as const, data: { accountId: accountId ?? null, session: null } };
          const session = await Effect.runPromise(withAccountSession("notes:read", (value) => Effect.succeed(value)));
          return { status: "success" as const, data: { accountId: accountId ?? null, session } };
        },
      }],
    }),
});

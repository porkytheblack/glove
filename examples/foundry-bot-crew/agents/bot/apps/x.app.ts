import { Effect } from "effect";
import { defineApp } from "glove-foundry";
import { z } from "zod";
import { replyOnX } from "../../../lib/x-api.js";
import xMentions from "../transmissions/x-mentions.transmission.js";

/**
 * Take tasks from X. Mentions arrive through the transmission; the reply
 * tool posts as the bot account, with a token only the account-session
 * adapter ever sees.
 */
export default defineApp({
  description: "Take tasks from @-mentions on X and acknowledge them there",
  inbound: [xMentions],
  install: ({ withAccountSession }) =>
    Effect.succeed({
      tools: [{
        name: "reply_on_x",
        description: "Reply on X to the post that tagged you, as the bot account. One short sentence.",
        inputSchema: z.object({
          inReplyTo: z.string().describe("The tweetId of the post that tagged you."),
          text: z.string().min(1).max(280),
        }),
        async do(input: { readonly inReplyTo: string; readonly text: string }) {
          if (!withAccountSession) {
            return { status: "error" as const, data: null, message: "Install the X app with the bot account." };
          }
          const posted = await Effect.runPromise(
            withAccountSession("x:reply", (session) =>
              Effect.promise(() => replyOnX((session as { readonly token: string }).token, input))),
          );
          return { status: "success" as const, data: posted };
        },
      }],
    }),
});

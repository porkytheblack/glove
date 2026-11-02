import { Effect } from "effect";
import { defineApp } from "glove-foundry";
import { z } from "zod";
import { postToSlack, type SlackPost } from "../../../lib/slack-api.js";
import { readOnly } from "../research.js";
import slackMessages from "../transmissions/slack-messages.transmission.js";

/**
 * The dot in Slack. Messages arrive through the transmission; the post tool
 * writes as the bot, with a token only the account-session adapter sees.
 * Runs on the dot's own time get no post tool: they read, they don't send.
 */
export default defineApp({
  description: "Talk with the dot in Slack: DMs and mentions in, posts out",
  inbound: [slackMessages],
  install: ({ withAccountSession, request }) =>
    Effect.succeed({
      tools: readOnly(request) ? [] : [{
        name: "post_to_slack",
        description:
          "Post in Slack as the bot. Use the channel the person wrote in, and thread_ts to answer in a thread. A user id as the channel posts in your DM with them.",
        inputSchema: z.object({
          channel: z.string().describe("A channel id (C…, D…) or a user id (U…)."),
          text: z.string().min(1).max(4000),
          thread_ts: z.string().optional().describe("The ts of the thread to answer in."),
        }),
        async do(post: SlackPost) {
          if (!withAccountSession) {
            return { status: "error" as const, data: null, message: "Install the Slack app with the bot account." };
          }
          const posted = await Effect.runPromise(
            withAccountSession("slack:post", (session) =>
              Effect.promise(() => postToSlack((session as { readonly token: string }).token, post))),
          );
          return { status: "success" as const, data: { posted: true, channel: post.channel, ...posted } };
        },
      }],
    }),
});

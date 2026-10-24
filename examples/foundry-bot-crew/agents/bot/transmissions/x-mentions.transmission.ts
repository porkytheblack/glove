import { Effect, Schema } from "effect";
import { defineTransmission } from "glove-foundry";
import mention from "../events/mention.event.js";
import fromOwner from "../predicates/from-owner.predicate.js";

/**
 * The fields we use from one tweet_create_events entry of X's Account
 * Activity webhook. The forwarder (see the README) checks X's signature and
 * sends one mention per event.
 */
export const XMentionWebhook = Schema.Struct({
  for_user_id: Schema.String,
  tweet: Schema.Struct({
    id_str: Schema.String,
    text: Schema.String,
    user: Schema.Struct({ id_str: Schema.String, screen_name: Schema.String }),
    in_reply_to_status_id_str: Schema.NullOr(Schema.String),
    replied_to_text: Schema.optional(Schema.String),
    quoted_text: Schema.optional(Schema.String),
  }),
});

/** Mentions of the bot account on X, as tasks for the person who wrote them. */
export default defineTransmission({
  name: "X mentions",
  description: "Posts on X that tag the bot account",
  account: {
    required: true,
    metadata: Schema.Struct({ handle: Schema.String }),
  },
  events: [mention],
  inbound: {
    config: Schema.Struct({ botUserId: Schema.String }),
    event: Schema.Struct({
      tweetId: Schema.String,
      authorId: Schema.String,
      author: Schema.String,
      text: Schema.String,
      inReplyTo: Schema.NullOr(Schema.String),
      context: Schema.String,
    }),
    adapter: {
      // The webhook must be for this route's bot account.
      authenticate: (raw, { route }) =>
        Schema.decodeUnknown(XMentionWebhook)(raw).pipe(
          Effect.map((hook) => hook.for_user_id === route.config.botUserId),
          Effect.orElseSucceed(() => false),
        ),
      normalize: (raw) =>
        Schema.decodeUnknown(XMentionWebhook)(raw).pipe(
          Effect.map(({ tweet }) => ({
            tweetId: tweet.id_str,
            authorId: tweet.user.id_str,
            author: tweet.user.screen_name,
            text: tweet.text,
            inReplyTo: tweet.in_reply_to_status_id_str,
            // What the post replied to or quoted is part of the task.
            context: [tweet.replied_to_text, tweet.quoted_text].filter(Boolean).join("\n\n"),
          })),
          Effect.orDie,
        ),
    },
    classify: () => Effect.succeed(mention),
    predicates: [fromOwner],
  },
});

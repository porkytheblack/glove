import { Effect, Schema } from "effect";
import { defineTransmission } from "glove-foundry";
import message from "../events/message.event.js";
import fromOwner from "../predicates/from-owner.predicate.js";

/**
 * The fields we use from a Slack Events API `event_callback`. The forwarder
 * (lib/slack-events.ts) checks Slack's signature and sends DMs and
 * mentions here; the bot's own posts never arrive.
 */
export const SlackEventCallback = Schema.Struct({
  type: Schema.Literal("event_callback"),
  team_id: Schema.String,
  api_app_id: Schema.String,
  event: Schema.Struct({
    type: Schema.Literal("message", "app_mention"),
    user: Schema.String,
    text: Schema.String,
    ts: Schema.String,
    channel: Schema.String,
    thread_ts: Schema.optional(Schema.String),
  }),
});

/** Slack messages to the bot, from the people who own a dot. */
export default defineTransmission({
  name: "Slack messages",
  description: "DMs to the bot and mentions of it in Slack channels",
  account: {
    required: true,
    metadata: Schema.Struct({ botUserId: Schema.String }),
  },
  events: [message],
  inbound: {
    config: Schema.Struct({ teamId: Schema.String, appId: Schema.String }),
    event: Schema.Struct({
      ts: Schema.String,
      channel: Schema.String,
      user: Schema.String,
      text: Schema.String,
      thread_ts: Schema.NullOr(Schema.String),
    }),
    adapter: {
      // The event must come from this route's Slack workspace and app.
      authenticate: (raw, { route }) =>
        Schema.decodeUnknown(SlackEventCallback)(raw).pipe(
          Effect.map((hook) => hook.team_id === route.config.teamId && hook.api_app_id === route.config.appId),
          Effect.orElseSucceed(() => false),
        ),
      normalize: (raw) =>
        Schema.decodeUnknown(SlackEventCallback)(raw).pipe(
          Effect.map(({ event }) => ({
            ts: event.ts,
            channel: event.channel,
            user: event.user,
            text: event.text,
            thread_ts: event.thread_ts ?? null,
          })),
          Effect.orDie,
        ),
    },
    classify: () => Effect.succeed(message),
    predicates: [fromOwner],
  },
});

import { Effect } from "effect";
import { defineTransmissionPredicate } from "glove-foundry";

/** By default a dot only answers its owner in Slack. */
export default defineTransmissionPredicate({
  description: "The message's author is parameters.slackUserId.",
  match: (event: { readonly user: string }, parameters) =>
    Effect.succeed(event.user === String(parameters.slackUserId ?? "")),
});

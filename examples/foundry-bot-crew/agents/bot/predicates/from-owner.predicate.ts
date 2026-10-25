import { Effect } from "effect";
import { defineTransmissionPredicate } from "glove-foundry";

/** Only the main bot's owner can hand it work from X. */
export default defineTransmissionPredicate({
  description: "The post's author is parameters.authorId.",
  match: (event: { readonly authorId: string }, parameters) =>
    Effect.succeed(event.authorId === String(parameters.authorId ?? "")),
});

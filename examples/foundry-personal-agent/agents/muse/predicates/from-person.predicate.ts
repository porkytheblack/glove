import { Effect } from "effect";
import { defineTransmissionPredicate } from "glove-foundry";

/** A person's Muse only answers that person's own WhatsApp number. */
export default defineTransmissionPredicate({
  description: "The message comes from parameters.phone.",
  match: (event: { readonly from: string }, parameters) =>
    Effect.succeed(event.from === String(parameters.phone ?? "")),
});

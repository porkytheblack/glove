import { Effect } from "effect";
import { defineTransmissionPredicate } from "glove-foundry";

const messageIncludes = defineTransmissionPredicate({
  match: (event: { readonly message: string }, parameters) => Effect.succeed(
    event.message.toLowerCase().includes(String(parameters.text ?? "").toLowerCase()),
  ),
});

export default messageIncludes;

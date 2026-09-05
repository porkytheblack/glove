import { Effect } from "effect";
import { defineTransmissionPredicate } from "glove-foundry";

const addressed = defineTransmissionPredicate({
  description: "Match messages explicitly addressed to the configured agent name",
  match: (event: { readonly text: string }, parameters) => {
    const name = String(parameters.name ?? "hermes").toLowerCase();
    return Effect.succeed(event.text.toLowerCase().includes(name));
  },
});

export default addressed;

import { Effect } from "effect";
import { defineTransmissionPredicate } from "glove-foundry";

/**
 * Predicates keep routing decisions out of the agent. A playbook references
 * this by value and supplies `parameters` at match time, so one predicate
 * serves many rules.
 */
const mentionsTrip = defineTransmissionPredicate({
  match: (event: { readonly text: string }, parameters) => {
    const needles = Array.isArray(parameters.any) ? parameters.any : ["trip", "flight", "travel"];
    const text = event.text.toLowerCase();
    return Effect.succeed(needles.some((needle) => text.includes(String(needle).toLowerCase())));
  },
});

export default mentionsTrip;

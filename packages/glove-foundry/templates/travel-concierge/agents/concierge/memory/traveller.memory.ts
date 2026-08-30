import { Effect } from "effect";
import { defineMemory } from "glove-foundry";
import { MemorySchema } from "glove-memory/core";
import { InMemoryContextAdapter } from "glove-memory/in-memory";

/**
 * Ambient context the concierge should carry between conversations: seat
 * preference, home airport, who is travelling. The adapter is replaceable —
 * point it at a durable store when you outgrow the in-memory one.
 */
const schema = new MemorySchema();
const context = new InMemoryContextAdapter({ schema });

const travellerMemory = defineMemory({
  description: "What we already know about this traveller",
  context: { adapter: () => Effect.succeed(context) },
});

export default travellerMemory;

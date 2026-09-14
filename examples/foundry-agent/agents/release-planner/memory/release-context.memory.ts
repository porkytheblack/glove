import { Effect } from "effect";
import { defineMemory } from "glove-foundry";
import { MemorySchema } from "glove-memory/core";
import { InMemoryContextAdapter } from "glove-memory/in-memory";

const adapter = new InMemoryContextAdapter({
  schema: new MemorySchema(),
  identifier: "foundry-example-release-context",
});

const releaseContext = defineMemory({
  description: "Ambient release context through glove-memory",
  context: { adapter: () => Effect.succeed(adapter) },
});

export default releaseContext;

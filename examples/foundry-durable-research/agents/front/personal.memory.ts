import { mkdirSync } from "node:fs";
import { Effect } from "effect";
import { defineMemory } from "glove-foundry";
import { MemorySchema } from "glove-memory/core";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { dataDir, dataPath } from "../../lib/paths.js";

export default defineMemory({
  description: "Persistent preferences scoped to the parent instance",
  context: {
    adapter: ({ workspaceId, agentId }) => Effect.sync(() => {
      mkdirSync(dataDir, { recursive: true });
      return createSqliteMemoryAdapters({
        file: dataPath("personal.sqlite"),
        namespace: JSON.stringify([workspaceId, agentId]),
        schema: new MemorySchema(),
      }).context;
    }),
  },
});

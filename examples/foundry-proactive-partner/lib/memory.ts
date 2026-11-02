import { mkdirSync } from "node:fs";
import { Effect } from "effect";
import { defineMemory } from "glove-foundry";
import { MemorySchema } from "glove-memory/core";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { dataDir, dataPath } from "./paths.js";

/** Memory in SQLite under a namespace per instance: one person, one memory. */
export function personalMemory(description: string) {
  return defineMemory({
    description,
    context: {
      adapter: ({ workspaceId, agentId }) =>
        Effect.sync(() => {
          mkdirSync(dataDir, { recursive: true });
          return createSqliteMemoryAdapters({
            file: dataPath("memory.sqlite"),
            namespace: `${workspaceId}/${agentId}`,
            schema: new MemorySchema(),
          }).context;
        }),
    },
  });
}

import { mkdirSync } from "node:fs";
import { Effect } from "effect";
import { defineMemory } from "glove-foundry";
import { MemorySchema } from "glove-memory/core";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { dataDir, dataPath } from "./paths.js";

/**
 * Pinned notes in SQLite under one namespace per instance. Every conversation
 * the instance has (the app, Slack) reads and writes the same namespace, so
 * what a dot learns in one channel it knows in the other.
 */
export function instanceMemory(description: string) {
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

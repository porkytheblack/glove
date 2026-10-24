import { mkdirSync } from "node:fs";
import { Effect } from "effect";
import { defineMemory } from "glove-foundry";
import { MemorySchema } from "glove-memory/core";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { dataDir, dataPath } from "./paths.js";

/**
 * Each bot's own memory: pinned notes in SQLite under a namespace per bot
 * instance, so the outreach bot's preferences never leak into the bug bot's.
 * Every agent folder default-exports one of these from a *.memory.ts file.
 */
export function botMemory(description: string) {
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

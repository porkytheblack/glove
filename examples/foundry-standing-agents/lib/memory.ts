import { mkdirSync } from "node:fs";
import { Effect } from "effect";
import { defineMemory } from "glove-foundry";
import { MemorySchema } from "glove-memory/core";
import { layerContext } from "glove-memory/layered";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { dataDir, dataPath } from "./paths.js";

function pinned(namespace: string) {
  mkdirSync(dataDir, { recursive: true });
  return createSqliteMemoryAdapters({ file: dataPath("memory.sqlite"), namespace, schema: new MemorySchema() }).context;
}

/**
 * The person's account memory, like ChatGPT's: one namespace per workspace,
 * written where the person manages it (your app). Their dot reads it and
 * can't change it.
 */
export function accountMemory(workspaceId: string) {
  return pinned(workspaceId);
}

/**
 * Pinned notes in SQLite: the person's account memory, read-only, over one
 * namespace of the instance's own that it writes. Every conversation the
 * instance has (the app, Slack) reads and writes the same namespace, so what
 * a dot learns in one channel it knows in the other.
 */
export function instanceMemory(description: string) {
  return defineMemory({
    description,
    context: {
      adapter: ({ workspaceId, agentId }) =>
        Effect.sync(() => layerContext([
          { name: "account", adapter: accountMemory(workspaceId), access: "read" },
          { name: "dot", adapter: pinned(`${workspaceId}/${agentId}`), access: "write" },
        ])),
    },
  });
}

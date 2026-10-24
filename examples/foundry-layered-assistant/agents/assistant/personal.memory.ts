import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Effect } from "effect";
import { defineMemory } from "glove-foundry";
import { MemorySchema } from "glove-memory/core";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { dataPath } from "../../lib/paths.js";

const file = dataPath("memory.sqlite");

/**
 * What the assistant knows about its person, kept as pinned context in
 * SQLite: one namespace per instance, so each person's memory stays theirs.
 * Only the interactor has it. Workers get what a task needs, in the task.
 */
export default defineMemory({
  description: "What the assistant knows about the person it works for",
  context: {
    adapter: ({ workspaceId, agentId }) =>
      Effect.sync(() => {
        mkdirSync(dirname(file), { recursive: true });
        return createSqliteMemoryAdapters({
          file,
          namespace: `${workspaceId}/${agentId}`,
          schema: new MemorySchema(),
        }).context;
      }),
  },
});

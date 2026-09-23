import { join } from "node:path";
import { z } from "zod";
import { MemorySchema } from "glove-memory/core";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { stateDir } from "./settings.js";

export interface MemoryScope { workspaceId: string; agentId: string; conversationId: string }
export const memorySchema = new MemorySchema()
  .defineNodeClass({ name: "known_item", schema: z.object({
    key: z.string(), name: z.string(), kind: z.enum(["person", "project", "site", "artifact"]), details: z.string(),
  }), identityKeys: [["key"]], searchableProperties: ["name", "details"] })
  .defineEpisodeKind({ name: "request", description: "An exact activation request, recorded by the host with its source." })
  .defineEpisodeKind({ name: "observation", description: "An observed result with its source and time; do not present speculation as observation." })
  .defineEpisodeKind({ name: "decision", description: "A user decision, correction, or constraint with provenance." })
  .defineEpisodeKind({ name: "checkpoint", description: "Progress or compaction checkpoint; not proof that an external action succeeded." })
  .defineResourceRoot({ path: "/notes", description: "Detailed research, plans and operating notes." })
  .defineResourceRoot({ path: "/requests", description: "Host-recorded activation requests for exact recall." })
  .defineResourceRoot({ path: "/checkpoints", description: "Archived compaction summaries; may contain unverified model conclusions." });

/** One conversation owns one namespace. Verification conversations never share it. */
export function operatorMemory(scope: MemoryScope, file = join(stateDir, "memory.sqlite")) {
  return createSqliteMemoryAdapters({ file, namespace: JSON.stringify([scope.workspaceId, scope.agentId, scope.conversationId]), schema: memorySchema, fuzzySearch: true });
}

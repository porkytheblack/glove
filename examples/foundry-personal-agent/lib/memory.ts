import { mkdirSync } from "node:fs";
import { Effect } from "effect";
import { defineGoals, defineMemory, foundryGuidanceSubject } from "glove-foundry";
import { MemorySchema } from "glove-memory/core";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { dataDir, dataPath } from "./paths.js";

/** One SQLite file, a namespace per instance: one person, one memory, one set of plans. */
function adaptersFor(workspaceId: string, agentId: string) {
  mkdirSync(dataDir, { recursive: true });
  return createSqliteMemoryAdapters({ file: dataPath("memory.sqlite"), namespace: `${workspaceId}/${agentId}`, schema: new MemorySchema() });
}

export function personalMemory(description: string) {
  return defineMemory({
    description,
    context: { adapter: ({ workspaceId, agentId }) => Effect.sync(() => adaptersFor(workspaceId, agentId).context) },
  });
}

/**
 * Plans are Foundry goals: one goal per plan, one item per step. Instance
 * scope, so a plan made on WhatsApp is the same plan in the app.
 */
export const plansScope = (workspaceId: string, agentId: string) =>
  ({ subject: foundryGuidanceSubject({ workspaceId, agentId, conversationId: "" }, "instance"), key: "plans" });
export const plansStore = (workspaceId: string, agentId: string) => adaptersFor(workspaceId, agentId).goals;
export const personalPlans = ({ workspaceId, agentId }: { readonly workspaceId: string; readonly agentId: string }) =>
  defineGoals({ adapter: plansStore(workspaceId, agentId), scope: plansScope(workspaceId, agentId) });

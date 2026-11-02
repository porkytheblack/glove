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

/**
 * What a person's Muse remembers, outside a run: for their app's "What it
 * remembers". The same entries glove_context_set keeps.
 */
export const memoryOf = (workspaceId: string, agentId: string) => adaptersFor(workspaceId, agentId).context;

/**
 * Forget one entry from the person's app: the same removal glove_context_unset
 * makes. False if this Muse has no such entry (another person's id, or gone).
 */
export async function forget(workspaceId: string, agentId: string, entryId: string): Promise<boolean> {
  const memory = memoryOf(workspaceId, agentId);
  if (!(await memory.get(entryId))) return false;
  await memory.unset(entryId, { source: "app", actor: `person:${workspaceId}`, timestamp: new Date().toISOString(), note: "Forget, from the app" });
  return true;
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

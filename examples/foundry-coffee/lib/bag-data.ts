import { Effect } from "effect";
import type { FoundryDataAdapter } from "glove-foundry";
import { EMPTY_VISIT, visitKey, type Visit } from "./bag.js";

// Reads and writes of a conversation's bag and orders, from inside a run.
// Only one run works on a conversation at a time, so read-then-write is safe.

export async function readVisit(data: FoundryDataAdapter, workspaceId: string, conversationId: string): Promise<Visit> {
  const entry = await Effect.runPromise(data.getWorkspaceEntry(workspaceId, visitKey(conversationId)));
  return (entry?.value as Visit | undefined) ?? EMPTY_VISIT;
}

export async function writeVisit(data: FoundryDataAdapter, workspaceId: string, conversationId: string, visit: Visit): Promise<void> {
  await Effect.runPromise(data.putWorkspaceEntry({
    workspaceId,
    key: visitKey(conversationId),
    value: visit,
    updatedAt: new Date().toISOString(),
  }));
}

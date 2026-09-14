import type { InboxItem } from "glove-core";
import type { AgentAssemblyContext } from "glove-foundry";

/** Load native Glove inbox data for this specific agent conversation. */
export async function loadOperationsInbox(
  context: AgentAssemblyContext,
): Promise<ReadonlyArray<InboxItem>> {
  // A production loader can query its own adapter by agentId/conversationId.
  void `${context.agentId}:${context.conversationId}`;
  return [];
}

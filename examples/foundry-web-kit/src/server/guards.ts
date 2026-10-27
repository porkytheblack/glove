import type { AgentInstance, Conversation } from "glove-foundry";
import { notFound } from "./errors";
import { foundry, type Foundry } from "./foundry";

// Foundry has no per-person auth, and runs, events and approvals are global
// lists. Before a route touches any of them it fetches the record and checks
// that the person's workspace owns it. Anything else is a 404, the same as a
// record that doesn't exist.

type Reads = Pick<Foundry, "agentInstances" | "conversations" | "getRun" | "approvals">;

/** The agent instance, if the workspace owns it. */
export async function ownedAgent(workspaceId: string, agentId: string, client: Reads = foundry()): Promise<AgentInstance> {
  const agent = (await client.agentInstances()).find((item) => item.id === agentId);
  if (!agent || agent.workspaceId !== workspaceId) throw notFound();
  return agent;
}

/** The workspace's agent instances, optionally of one definition. */
export async function ownedAgents(workspaceId: string, definitionId?: string, client: Pick<Foundry, "agentInstances"> = foundry()): Promise<ReadonlyArray<AgentInstance>> {
  return (await client.agentInstances(definitionId)).filter((item) => item.workspaceId === workspaceId);
}

/** A conversation of an owned agent, if it is in the same workspace. */
export async function ownedConversation(workspaceId: string, agentId: string, conversationId: string, client: Reads = foundry()): Promise<Conversation> {
  await ownedAgent(workspaceId, agentId, client);
  const conversation = (await client.conversations(agentId)).find((item) => item.id === conversationId);
  if (!conversation || conversation.workspaceId !== workspaceId) throw notFound();
  return conversation;
}

/** A run, if the workspace owns it. */
export async function ownedRun(workspaceId: string, runId: string, client: Reads = foundry()) {
  const run = await client.getRun(runId).catch(() => undefined);
  if (!run || run.workspaceId !== workspaceId) throw notFound();
  return run;
}

/** An approval, if the workspace owns it. */
export async function ownedApproval(workspaceId: string, approvalId: string, client: Reads = foundry()) {
  const approval = (await client.approvals()).find((item) => item.id === approvalId);
  if (!approval || approval.workspaceId !== workspaceId) throw notFound();
  return approval;
}

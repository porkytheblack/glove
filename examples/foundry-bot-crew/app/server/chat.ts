import "server-only";
import type { AgentInstance } from "glove-foundry";
import { displayMessages, foundry, ownedAgent, ownedAgents, pendingApprovals, type ApprovalView, type DisplayMessage } from "glove-foundry-web-kit/server";
import { chatDisplay, describeApprovals } from "./crew";
import { host } from "./host";

/** What a bot's chat shows: the latest messages, its pending approvals, and the run in progress. */
export interface ChatState {
  readonly messages: ReadonlyArray<DisplayMessage>;
  readonly approvals: ReadonlyArray<ApprovalView>;
  readonly runId: string | null;
  readonly total: number;
}

const LATEST = 200;

/** The bot's own chat, opened on first use (a bot made before it had one). */
export async function chatOf(bot: AgentInstance): Promise<string> {
  const { chatWith } = (await host()).people;
  const options = chatWith(bot.id);
  const client = foundry();
  const existing = (await client.conversations(bot.id)).find((item) => item.id === options.id);
  if (existing) return existing.id;
  return (await client.createConversation(bot.id, options)).id;
}

/** The latest page of a conversation, as display messages. */
export async function messagesOf(botId: string, conversationId: string, team: ReadonlyArray<AgentInstance>) {
  const client = foundry();
  const { page } = await client.conversationTranscript(botId, conversationId, { offset: 0, limit: 1 });
  const offset = Math.max(0, page.total - LATEST);
  const transcript = await client.conversationTranscript(botId, conversationId, { offset, limit: LATEST });
  return { messages: displayMessages(transcript, chatDisplay(team)), total: page.total };
}

/** The run in progress in a conversation, if any. */
export async function activeRun(personId: string, conversationId: string): Promise<string | null> {
  const runs = (await foundry().runs("bot")).filter((run) =>
    run.workspaceId === personId && run.conversationId === conversationId && (run.status === "running" || run.status === "pending"));
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id ?? null;
}

export async function chatState(personId: string, botId: string): Promise<ChatState> {
  const bot = await ownedAgent(personId, botId);
  const team = await ownedAgents(personId, "bot");
  const conversationId = await chatOf(bot);
  const [{ messages, total }, approvals, runId] = await Promise.all([
    messagesOf(bot.id, conversationId, team),
    pendingApprovals(personId, { filter: (approval) => approval.agentId === bot.id, describe: await describeApprovals({ id: personId }, team) }),
    activeRun(personId, conversationId),
  ]);
  // The run in progress replays from its start on the live stream, so its replies so far come from there.
  return { messages: runId ? withoutTrailingReplies(messages) : messages, approvals, runId, total };
}

/** Drops the agent's messages after the last thing it was sent. */
export function withoutTrailingReplies<T extends { readonly sender: string }>(messages: ReadonlyArray<T>): T[] {
  let end = messages.length;
  while (end > 0 && messages[end - 1]!.sender === "agent") end--;
  return messages.slice(0, end);
}

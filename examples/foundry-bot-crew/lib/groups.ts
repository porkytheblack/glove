import type { AgentInstance, Conversation, CreateConversationOptions, FoundryClient, FoundryRouteMap, FoundryRuntime } from "glove-foundry";
import { chatWith, primaryOf } from "./people.js";

/**
 * A group chat: the person and 2–6 of their bots. No bot hosts it. Each member
 * keeps its own conversation for the group, and your app shows them merged.
 * A message goes to the bots it @-mentions; @everyone, or no mention at all,
 * goes to every member, and a bot with nothing to add replies with nothing.
 */
export interface GroupChat {
  readonly id: string;
  readonly name: string;
  /** Bot instance ids. */
  readonly members: ReadonlyArray<string>;
}

/** What posting a message needs, from the runtime in a script or the typed client in your app. */
export interface FoundryChats {
  readonly agents: () => Promise<ReadonlyArray<AgentInstance>>;
  readonly createConversation: (agentId: string, options: CreateConversationOptions) => Promise<Conversation>;
  readonly send: (agentId: string, conversationId: string, text: string) => Promise<{ readonly id: string }>;
}

export const chatsVia = {
  runtime: (runtime: FoundryRuntime): FoundryChats => ({
    agents: () => runtime.listAgentInstances("bot"),
    createConversation: (agentId, options) => runtime.createConversation(agentId, options),
    send: (agentId, conversationId, text) => runtime.send(agentId, conversationId, text),
  }),
  client: (client: FoundryClient<FoundryRouteMap>): FoundryChats => ({
    agents: () => client.agentInstances("bot"),
    createConversation: (agentId, options) => client.createConversation(agentId, options),
    send: (agentId, conversationId, text) => client.send(agentId, conversationId, text),
  }),
};

/** A member's conversation for the group. */
export function groupConversationId(botId: string, chat: Pick<GroupChat, "id">): string {
  return `${botId}--${chat.id}`;
}

/** Open the group: one conversation per member, whose data says who else is in it. */
export async function openGroup(foundry: FoundryChats, chat: GroupChat): Promise<void> {
  for (const member of chat.members) {
    await foundry.createConversation(member, {
      id: groupConversationId(member, chat),
      title: chat.name,
      context: { conversationKey: `group:${chat.id}`, group: { id: chat.id, name: chat.name, members: [...chat.members] } },
    });
  }
}

/** The members a message is for: the ones it @-mentions, or all of them. */
export function addressed(text: string, members: ReadonlyArray<Pick<AgentInstance, "id" | "name">>): ReadonlyArray<string> {
  if (/@everyone\b/i.test(text)) return members.map((member) => member.id);
  const lower = text.toLowerCase();
  const mentioned = members.filter((member) => member.name && lower.includes(`@${member.name.toLowerCase()}`));
  return (mentioned.length > 0 ? mentioned : members).map((member) => member.id);
}

/** Post the person's message: each addressed bot gets it in its own conversation for the group. */
export async function postToGroup(foundry: FoundryChats, chat: GroupChat, text: string): Promise<ReadonlyArray<{ readonly botId: string; readonly runId: string }>> {
  const team = await foundry.agents();
  const members = chat.members.map((id) => team.find((agent) => agent.id === id) ?? { id });
  const runs = [];
  for (const botId of addressed(text, members)) {
    const run = await foundry.send(botId, groupConversationId(botId, chat), text);
    runs.push({ botId, runId: run.id });
  }
  return runs;
}

/**
 * An ask that names no bot goes to the person's starred bot, in its own chat.
 * It does its part and hands each sibling theirs over the mesh. Group chats
 * keep their own rule (postToGroup).
 */
export async function askPrimary(foundry: FoundryChats, personId: string, text: string): Promise<{ readonly botId: string; readonly runId: string }> {
  const primary = primaryOf(await foundry.agents(), personId);
  if (!primary) throw new Error(`${personId} has no starred bot.`);
  const run = await foundry.send(primary.id, chatWith(primary.id).id!, text);
  return { botId: primary.id, runId: run.id };
}

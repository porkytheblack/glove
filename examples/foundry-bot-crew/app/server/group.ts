import "server-only";
import type { AgentInstance } from "glove-foundry";
import { displayMessages, foundry, notFound, ownedAgents, pendingApprovals, type ApprovalView, type DisplayMessage } from "glove-foundry-web-kit/server";
import { withoutTrailingReplies } from "./chat";
import { chatDisplay, describeApprovals, groupsOf, initials, type GroupSummary } from "./crew";
import { host } from "./host";

export interface Member {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
}

export interface GroupState {
  readonly group: GroupSummary;
  readonly members: ReadonlyArray<Member>;
  readonly messages: ReadonlyArray<DisplayMessage>;
  /** Which member wrote each agent message, by message id. */
  readonly authors: Readonly<Record<string, string>>;
  readonly approvals: ReadonlyArray<ApprovalView>;
  /** Members still answering: their runs, to follow live. */
  readonly runs: ReadonlyArray<{ readonly botId: string; readonly runId: string }>;
}

/** A group chat of the person's, with its members as they are now. */
export async function ownedGroup(personId: string, groupId: string) {
  const team = await ownedAgents(personId, "bot");
  const group = (await groupsOf(team)).find((item) => item.id === groupId);
  if (!group) throw notFound();
  const members = group.members.flatMap((id) => {
    const bot = team.find((item) => item.id === id);
    return bot ? [{ id: bot.id, name: bot.name ?? "New bot", initials: bot.description ? initials(bot.name ?? "") : "?" }] : [];
  });
  return { group: { ...group, members: members.map((member) => member.id) }, members, team };
}

interface Turn {
  readonly at: string;
  readonly order: number;
  readonly memberId: string;
  readonly person?: DisplayMessage;
  replies: DisplayMessage[];
}

/**
 * The group as one thread. No bot hosts it: each member keeps its own
 * conversation, holding the messages addressed to it. A message the person
 * sent to several members shows once, followed by each one's answer, in the
 * order the runs started.
 */
export async function groupState(personId: string, groupId: string): Promise<GroupState> {
  const { group, members, team } = await ownedGroup(personId, groupId);
  const { groupConversationId } = (await host()).groups;
  const client = foundry();
  const runs = (await client.runs("bot")).filter((run) => run.workspaceId === personId);
  const turns: Turn[] = [];
  const active: Array<{ botId: string; runId: string }> = [];
  for (const member of members) {
    const conversationId = groupConversationId(member.id, group);
    const own = runs.filter((run) => run.conversationId === conversationId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const run of own) if (run.status === "running" || run.status === "pending") active.push({ botId: member.id, runId: run.id });
    const transcript = await client.conversationTranscript(member.id, conversationId, { offset: 0, limit: 500 }).catch(() => undefined);
    if (!transcript) continue;
    let turn: Turn | undefined;
    let index = 0;
    for (const message of displayMessages(transcript, chatDisplay(team))) {
      const keyed = { ...message, id: `${member.id}:${message.id}` };
      // Each of the person's messages started one run here, in order.
      if (message.sender === "person") {
        turn = { at: own[index++]?.createdAt ?? "", order: turns.length, memberId: member.id, person: keyed, replies: [] };
        turns.push(turn);
        continue;
      }
      if (!turn) {
        turn = { at: "", order: turns.length, memberId: member.id, replies: [] };
        turns.push(turn);
      }
      turn.replies.push(keyed);
    }
    // A member still answering streams its reply live, from the start.
    if (turn && own.some((run) => run.status === "running" || run.status === "pending")) turn.replies = withoutTrailingReplies(turn.replies);
  }
  turns.sort((a, b) => (a.at || "~").localeCompare(b.at || "~") || a.order - b.order);

  const messages: DisplayMessage[] = [];
  const authors: Record<string, string> = {};
  let last: { text: string; at: number } | undefined;
  for (const turn of turns) {
    const at = Date.parse(turn.at);
    // The same message sent to several members within a few seconds is one post.
    const same = turn.person && last && last.text === turn.person.text && Math.abs(at - last.at) < 10_000;
    if (turn.person && !same) {
      messages.push(turn.person);
      last = { text: turn.person.text, at };
    }
    for (const reply of turn.replies) {
      messages.push(reply);
      if (reply.sender === "agent") authors[reply.id] = turn.memberId;
    }
  }

  const conversations = members.map((member) => groupConversationId(member.id, group));
  const approvals = await pendingApprovals(personId, {
    filter: (approval) => conversations.includes(approval.conversationId),
    describe: await describeApprovals({ id: personId }, team),
  });
  return { group, members, messages, authors, approvals, runs: active };
}

/** A group id from its name, not used by another of the person's groups. */
export function groupIdFor(name: string, taken: ReadonlyArray<GroupSummary>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "group";
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!taken.some((group) => group.id === id)) return id;
  }
}

/** The person's bots by id, checking each is theirs. */
export function membersFrom(team: ReadonlyArray<AgentInstance>, ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && team.some((bot) => bot.id === id)))];
}

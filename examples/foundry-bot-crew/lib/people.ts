import type { AgentInstallation, CreateAgentInstanceOptions } from "glove-foundry";

/**
 * A person's account, as data. Their workspace is their team: every bot they
 * own lives there and only sees the others there. These functions return
 * plain instance data. The application seeds a demo person with them through
 * defineAgentInstance, and your app creates everyone else's at runtime.
 */
export interface Person {
  readonly id: string;
  readonly name: string;
}

/**
 * The person's main bot. It takes everyday requests that belong to no other
 * bot, routes work to the bot whose job fits, and reads new mail when Gmail
 * is connected. Its name is the person's to choose.
 */
export function mainBotFor(
  person: Person,
  bot: { readonly name: string; readonly installations?: ReadonlyArray<AgentInstallation> },
): CreateAgentInstanceOptions {
  return {
    id: `${person.id}-main`,
    workspaceId: person.id,
    name: bot.name,
    description: `${person.name}'s main bot. Takes everyday requests and hands work to the bot whose job fits.`,
    context: { owner: person.name, primary: true },
    installations: [...(bot.installations ?? [])],
  };
}

/**
 * Any other bot. Without a job it introduces itself and asks for one; with a
 * job it starts ready. Its id is the app's to choose and never changes; its
 * name can change any time. Give it the person's apps with giveAccounts.
 */
export function botFor(
  person: Person,
  bot: { readonly id: string; readonly name?: string; readonly job?: string },
): CreateAgentInstanceOptions {
  return {
    id: bot.id,
    workspaceId: person.id,
    name: bot.name ?? "New bot",
    ...(bot.job ? { description: bot.job } : {}),
    context: { owner: person.name },
  };
}

/** A group chat: a conversation on the bot that hosts it, whose data lists the bots in it. */
export function groupChat(chat: { readonly id: string; readonly name: string; readonly members: ReadonlyArray<string> }) {
  return { id: chat.id, title: chat.name, context: { group: { name: chat.name, members: [...chat.members] } } };
}

/** The main bot's thread. New mail joins it through its key. */
export const MAIN_THREAD = { key: "main", title: "Main" } as const;

/** The demo account `pnpm dev` and `pnpm verify` start with. */
export const MAYA: Person = { id: "maya", name: "Maya" };

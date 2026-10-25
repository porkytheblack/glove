import type { AgentInstallation, CreateAgentInstanceOptions, CreateConversationOptions } from "glove-foundry";

/**
 * A person's account, as data. Their workspace is their team: every bot they
 * own lives there and only sees the others there. The bots are siblings: one
 * definition, no bot above the others. These functions return plain instance
 * data. The application seeds a demo person with them through
 * defineAgentInstance, and your app creates everyone else's at runtime.
 */
export interface Person {
  readonly id: string;
  readonly name: string;
}

/**
 * A routine that runs after an event, on the one bot it belongs to. Routines
 * on a schedule are Foundry schedules the bot makes with glove_foundry_schedule;
 * a routine after an event is a playbook built from this data.
 */
export interface EventRoutine {
  readonly on: "new-mail";
  /** The saved skill it runs, if any. */
  readonly skill?: string;
  readonly instruction: string;
}

/**
 * A bot. Without a job it introduces itself and asks for one; with a job it
 * starts ready. Its id is the app's to choose and never changes; its name can
 * change any time. Give it the person's apps with giveAccounts, or pass the
 * installations here when seeding.
 */
export function botFor(
  person: Person,
  bot: {
    readonly id: string;
    readonly name?: string;
    readonly job?: string;
    readonly routines?: ReadonlyArray<EventRoutine>;
    readonly installations?: ReadonlyArray<AgentInstallation>;
  },
): CreateAgentInstanceOptions {
  return {
    id: bot.id,
    workspaceId: person.id,
    name: bot.name ?? "New bot",
    ...(bot.job ? { description: bot.job } : {}),
    context: { owner: person.name, routines: [...(bot.routines ?? [])] },
    installations: [...(bot.installations ?? [])],
  };
}

/** Every bot's own chat with its person. New mail for a bot joins it through its key. */
export const CHAT = { key: "chat", title: "Chat" } as const;

/** The options that open a bot's chat. */
export function chatWith(botId: string): CreateConversationOptions {
  return { id: `${botId}-chat`, title: CHAT.title, context: { conversationKey: CHAT.key } };
}

/** The demo account `pnpm dev` and `pnpm verify` start with. */
export const MAYA: Person = { id: "maya", name: "Maya" };

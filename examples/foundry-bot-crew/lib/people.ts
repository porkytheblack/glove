import type {
  AgentInstallation,
  AgentInstance,
  CreateAgentInstanceOptions,
  CreateConversationOptions,
  FoundryScheduleTimingInput,
} from "glove-foundry";
import type { FoundryWrites } from "./connect.js";

/**
 * A person's account, as data. Their workspace is their team: every bot they
 * own lives there and only sees the others there. The bots are siblings: one
 * definition and no coordinator kind. One of them is starred as the Primary
 * Bot, which takes the asks that name no bot; the star is data you can move.
 * These functions return plain instance data. The application seeds a demo
 * person with them through defineAgentInstance, and your app creates everyone
 * else's at runtime.
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
 * A routine on a schedule carried as data, by a copy or a template. Foundry
 * arms it from the bot's `context.schedules` on the bot's next run.
 */
export interface ScheduledRoutine {
  readonly name: string;
  readonly message: string;
  readonly timing: FoundryScheduleTimingInput;
}

/** Grok Bot's limits: 50 bots per person, 50 routines per bot. */
export const MAX_BOTS = 50;
export const MAX_ROUTINES = 50;

/**
 * A bot. Without a job it introduces itself and asks for one; with a job it
 * starts ready. Its id is the app's to choose and never changes; its name can
 * change any time. makeBot (lib/connect.ts) creates it with the person's
 * apps; pass the installations here when seeding.
 */
export function botFor(
  person: Person,
  bot: {
    readonly id: string;
    readonly name?: string;
    readonly job?: string;
    /** How it works: tone, when to check in. At most 200 characters. */
    readonly style?: string;
    /** The person's Primary Bot, which takes the asks that name no bot. */
    readonly starred?: boolean;
    readonly routines?: ReadonlyArray<EventRoutine>;
    readonly schedules?: ReadonlyArray<ScheduledRoutine>;
    readonly installations?: ReadonlyArray<AgentInstallation>;
  },
): CreateAgentInstanceOptions {
  return {
    id: bot.id,
    workspaceId: person.id,
    name: bot.name ?? "New bot",
    ...(bot.job ? { description: bot.job } : {}),
    context: {
      owner: person.name,
      ...(bot.style ? { style: bot.style } : {}),
      ...(bot.starred ? { starred: true } : {}),
      routines: [...(bot.routines ?? [])],
      ...(bot.schedules?.length ? { schedules: [...bot.schedules] } : {}),
    },
    installations: [...(bot.installations ?? [])],
  };
}

/** The person's Primary Bot: the starred one among their bots. */
export function primaryOf(bots: ReadonlyArray<AgentInstance>, personId: string): AgentInstance | undefined {
  return bots.find((bot) => bot.workspaceId === personId && bot.context.starred === true);
}

/** Move the star: unstar the person's other bots, star this one. */
export async function starBot(foundry: FoundryWrites, person: Pick<Person, "id">, botId: string): Promise<void> {
  for (const bot of await foundry.agents()) {
    if (bot.workspaceId !== person.id || Boolean(bot.context.starred) === (bot.id === botId)) continue;
    const { starred: _starred, ...context } = bot.context;
    await foundry.configure(bot.id, { context: bot.id === botId ? { ...context, starred: true } : context });
  }
}

/** Every bot's own chat with its person. New mail for a bot joins it through its key. */
export const CHAT = { key: "chat", title: "Chat" } as const;

/** The options that open a bot's chat. */
export function chatWith(botId: string): CreateConversationOptions {
  return { id: `${botId}-chat`, title: CHAT.title, context: { conversationKey: CHAT.key } };
}

/** The demo account `pnpm dev` and `pnpm verify` start with. */
export const MAYA: Person = { id: "maya", name: "Maya" };

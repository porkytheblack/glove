import { install } from "glove-foundry";
import gmail from "../agents/bot/apps/gmail.app.js";
import sheets from "../agents/bot/apps/sheets.app.js";
import tickets from "../agents/bot/apps/tickets.app.js";
import xApp from "../agents/bot/apps/x.app.js";
import { xBot } from "../agents/bot/topology.js";

/**
 * A person's account, as data. Their workspace is their team: every bot they
 * own lives there and only sees the others there. Nothing here is code a new
 * bot needs; a new bot is one more instance.
 */
export interface Person {
  readonly id: string;
  readonly name: string;
  /** Their X account, once connected. */
  readonly xUserId?: string;
}

/** The Chief: the bot that runs the others. */
export function chiefFor(person: Person) {
  return {
    id: `${person.id}-chief`,
    workspaceId: person.id,
    name: "Chief",
    description: `${person.name}'s chief of staff. Hands work to the right bot and keeps ${person.name} posted.`,
    context: { owner: person.name, role: "chief", ...(person.xUserId ? { xUserId: person.xUserId } : {}) },
    installations: person.xUserId ? [install(xApp, undefined, { account: xBot })] : [],
  };
}

/** Apps a person can give a bot. Which ones a bot has is data too. */
export const APPS = { gmail, sheets, tickets } as const;
export type AppName = keyof typeof APPS;

/**
 * A new bot. Without a job it introduces itself and asks for one; with a job
 * it starts ready. Its id is the app's to choose and never changes; its name
 * can change any time.
 */
export function botFor(person: Person, bot: { readonly id: string; readonly name?: string; readonly job?: string; readonly apps?: ReadonlyArray<AppName> }) {
  return {
    id: bot.id,
    workspaceId: person.id,
    name: bot.name ?? "New bot",
    ...(bot.job ? { description: bot.job } : {}),
    context: { owner: person.name },
    installations: (bot.apps ?? []).map((app) => install(APPS[app])),
  };
}

/** A group chat: a conversation on the Chief whose data lists the bots in it. */
export function groupChat(person: Person, chat: { readonly id: string; readonly name: string; readonly members: ReadonlyArray<string> }) {
  return { id: chat.id, workspaceId: person.id, title: chat.name, context: { group: { name: chat.name, members: [...chat.members] } } };
}

/** The Chief's main thread. Mentions from X join it through its key. */
export const MAIN_THREAD = { key: "main", title: "Chief" } as const;

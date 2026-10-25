import { install, type AgentInstance, type CreateAgentInstanceOptions } from "glove-foundry";
import gmail from "../agents/bot/apps/gmail.app.js";
import sheets from "../agents/bot/apps/sheets.app.js";
import tickets from "../agents/bot/apps/tickets.app.js";
import xApp from "../agents/bot/apps/x.app.js";
import { xBot } from "../agents/bot/topology.js";

/**
 * A person's account, as data. Their workspace is their team: every bot they
 * own lives there and only sees the others there. These functions return
 * plain instance data. The application seeds a demo person with them through
 * defineAgentInstance, and your app creates everyone else's at runtime.
 */
export interface Person {
  readonly id: string;
  readonly name: string;
  /** Their X account, once connected. */
  readonly xUserId?: string;
}

/**
 * Apps a person can connect. Apps are account-wide: once connected, every one
 * of the person's bots has it, so a bot is created with the account's apps
 * and connect_app installs a new one on every bot.
 */
export const APPS = { gmail, sheets, tickets } as const;
export type AppName = keyof typeof APPS;
export const APP_NAMES = Object.keys(APPS) as AppName[];

/** The account's connected apps, read from any of its bots. */
export function appsOf(bot: Pick<AgentInstance, "installations">): AppName[] {
  return APP_NAMES.filter((name) => bot.installations.some((item) => item.kind === "application" && item.id === APPS[name].id));
}

/**
 * The person's main bot. It takes everyday requests that belong to no other
 * bot, routes work to the bot whose job fits, and is the one @bot on X hands
 * tagged posts to. Its name is the person's to choose.
 */
export function mainBotFor(person: Person, bot: { readonly name: string; readonly apps: ReadonlyArray<AppName> }): CreateAgentInstanceOptions {
  return {
    id: `${person.id}-main`,
    workspaceId: person.id,
    name: bot.name,
    description: `${person.name}'s main bot. Takes everyday requests and hands work to the bot whose job fits.`,
    context: { owner: person.name, primary: true, ...(person.xUserId ? { xUserId: person.xUserId } : {}) },
    installations: [
      ...bot.apps.map((app) => install(APPS[app])),
      ...(person.xUserId ? [install(xApp, undefined, { account: xBot })] : []),
    ],
  };
}

/**
 * Any other bot. Without a job it introduces itself and asks for one; with a
 * job it starts ready. Its id is the app's to choose and never changes; its
 * name can change any time.
 */
export function botFor(
  person: Person,
  bot: { readonly id: string; readonly name?: string; readonly job?: string; readonly apps: ReadonlyArray<AppName> },
): CreateAgentInstanceOptions {
  return {
    id: bot.id,
    workspaceId: person.id,
    name: bot.name ?? "New bot",
    ...(bot.job ? { description: bot.job } : {}),
    context: { owner: person.name },
    installations: bot.apps.map((app) => install(APPS[app])),
  };
}

/** A group chat: a conversation on the bot that hosts it, whose data lists the bots in it. */
export function groupChat(chat: { readonly id: string; readonly name: string; readonly members: ReadonlyArray<string> }) {
  return { id: chat.id, title: chat.name, context: { group: { name: chat.name, members: [...chat.members] } } };
}

/** The main bot's thread. Tagged posts from X join it through its key. */
export const MAIN_THREAD = { key: "main", title: "Main" } as const;

/** The demo account `pnpm dev` and `pnpm verify` start with. */
export const MAYA: Person = { id: "maya", name: "Maya", xUserId: "42" };
export const MAYA_MAIN_BOT = mainBotFor(MAYA, { name: "Chief", apps: ["gmail", "sheets"] });

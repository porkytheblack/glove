import type { AgentInstance } from "glove-foundry";
import { skillKey, type SavedSkill } from "../agents/bot/skills.js";
import { accountsOf } from "./accounts.js";
import { APPS, installationFor, makeBot, type AppName, type FoundryWrites } from "./connect.js";
import { memoryOf } from "./memory.js";
import type { EventRoutine, Person, ScheduledRoutine } from "./people.js";

// Copies and templates, as data. A copy is a new bot for the same person; a
// template carries a bot to anyone. Neither brings chats, accounts or keys,
// and only a template brings memory: the notes its author picks.

/** A bot's routines on a schedule: the ones it carries as data and the ones it set with glove_foundry_schedule. */
async function schedulesOf(foundry: FoundryWrites, bot: AgentInstance): Promise<ScheduledRoutine[]> {
  const own = (await foundry.activations(bot.workspaceId)).filter((item) =>
    item.agentId === bot.id && item.kind === "scheduled" && item.origin === "agent-tool" &&
    item.status !== "completed" && item.status !== "cancelled");
  return [
    ...((bot.context.schedules ?? []) as ReadonlyArray<ScheduledRoutine>),
    // A one-off ("at") is not a routine.
    ...own.flatMap(({ id, message, timing }): ScheduledRoutine[] =>
      timing.kind === "cron" ? [{ name: id, message, timing }]
      : timing.kind === "every" ? [{ name: id, message, timing: { kind: "every", interval: `${timing.intervalMs}ms` } }]
      : []),
  ];
}

/**
 * Duplicate a bot: a new bot for the same person with its name, job, working
 * style, routines (schedules included) and app installations. Its memory and
 * chats stay with the original. Skills are the person's library, so the copy
 * has them already. Foundry arms the copy's schedules on its first run.
 */
export async function duplicateBot(foundry: FoundryWrites, person: Person, botId: string, copyId: string): Promise<AgentInstance> {
  const source = (await foundry.agents()).find((bot) => bot.id === botId && bot.workspaceId === person.id);
  if (!source) throw new Error(`${person.name} has no bot "${botId}".`);
  await makeBot(foundry, person, {
    id: copyId,
    name: `${source.name ?? "Bot"} (copy)`,
    ...(source.description ? { job: source.description } : {}),
    ...(typeof source.context.style === "string" ? { style: source.context.style } : {}),
    routines: (source.context.routines ?? []) as ReadonlyArray<EventRoutine>,
    schedules: await schedulesOf(foundry, source),
  });
  // The original's installations, with its "Always allow" and "Always ask" rules.
  for (const installation of source.installations) await foundry.install(copyId, installation);
  return (await foundry.agents()).find((bot) => bot.id === copyId)!;
}

/**
 * A bot to share: its instructions, the memories its author picked, skills,
 * routines and first-party apps with their approval rules. No chats,
 * accounts, keys, custom MCP servers or scripts.
 */
export interface BotTemplate {
  readonly name: string;
  readonly job: string;
  readonly style?: string;
  readonly memories: ReadonlyArray<string>;
  readonly skills: ReadonlyArray<Omit<SavedSkill, "by">>;
  readonly routines: ReadonlyArray<EventRoutine>;
  readonly schedules: ReadonlyArray<ScheduledRoutine>;
  readonly apps: ReadonlyArray<{ readonly app: AppName; readonly alwaysAllow: ReadonlyArray<string>; readonly alwaysAsk: ReadonlyArray<string> }>;
}

/** A template of a bot, with the memories and skills its owner picks. */
export async function templateOf(
  foundry: FoundryWrites,
  bot: AgentInstance,
  picked: { readonly memories?: ReadonlyArray<string>; readonly skills?: ReadonlyArray<SavedSkill> } = {},
): Promise<BotTemplate> {
  const names = Object.keys(APPS) as AppName[];
  return {
    name: bot.name ?? "Bot",
    job: bot.description ?? "",
    ...(typeof bot.context.style === "string" ? { style: bot.context.style } : {}),
    memories: [...(picked.memories ?? [])],
    skills: (picked.skills ?? []).map(({ by: _by, ...skill }) => skill),
    routines: [...((bot.context.routines ?? []) as ReadonlyArray<EventRoutine>)],
    schedules: await schedulesOf(foundry, bot),
    apps: bot.installations.flatMap((installation) => {
      const app = names.find((name) => installation.kind === "application" && APPS[name].id === installation.id);
      const config = (installation.config ?? {}) as { readonly alwaysAllow?: string[]; readonly alwaysAsk?: string[] };
      return app ? [{ app, alwaysAllow: [...(config.alwaysAllow ?? [])], alwaysAsk: [...(config.alwaysAsk ?? [])] }] : [];
    }),
  };
}

/**
 * A new bot from a template. Its skills join the person's library (replacing
 * one of the same name), its memories become the bot's first notes, and its
 * apps install with the person's own accounts, for the ones they connected;
 * the bot asks for the rest with connect_app.
 */
export async function fromTemplate(foundry: FoundryWrites, person: Person, template: BotTemplate, id: string): Promise<AgentInstance> {
  const bot = await makeBot(foundry, person, {
    id,
    name: template.name,
    job: template.job,
    ...(template.style ? { style: template.style } : {}),
    routines: template.routines,
    schedules: template.schedules,
  });
  for (const skill of template.skills) await foundry.putEntry(person.id, skillKey(skill.name), { ...skill, by: id });
  for (const account of await accountsOf(person.id)) {
    const rules = template.apps.find((item) => item.app === account.app);
    if (rules) await foundry.install(id, installationFor(account, rules.alwaysAllow, rules.alwaysAsk));
  }
  const memory = memoryOf(person.id, id);
  for (const content of template.memories) {
    await memory.set({ section: "template", content, pinned: true }, { source: `template:${template.name}`, actor: person.id, timestamp: new Date().toISOString() });
  }
  return bot;
}

/** The marketplace: ready-made bots anyone can start from. */
export const MARKETPLACE: ReadonlyArray<BotTemplate> = [
  {
    name: "Inbox Manager",
    job: "Keeps your inbox moving: answers what it can from your address and hands the rest to the bot whose job it is.",
    style: "Short replies in your voice. Checks in before anything that commits you to a date or a price.",
    memories: [],
    skills: [],
    routines: [{ on: "new-mail", instruction: "Read each new email. Answer the ones you can; hand the rest to a sibling or tell your owner in one line." }],
    schedules: [],
    apps: [{ app: "gmail", alwaysAllow: [], alwaysAsk: [] }],
  },
  {
    name: "Sales Outbound",
    job: "Overnight pipeline generation: picks prospects from signup emails, researches them and drafts intros for your approval.",
    style: "Two-line intros, no hype.",
    memories: [],
    skills: [{
      name: "monday-signups",
      description: "Sweep last week's signups and draft an intro for each.",
      steps: "1. Search Gmail for signup emails from the past 7 days.\n2. Skip anyone already emailed.\n3. Draft a two-line intro for each and queue it for approval.",
    }],
    routines: [],
    schedules: [{ name: "monday-signups", message: "Run the monday-signups skill. Read it with glove_read_skill first.", timing: { kind: "cron", expression: "0 9 * * 1" } }],
    apps: [{ app: "gmail", alwaysAllow: [], alwaysAsk: [] }],
  },
];

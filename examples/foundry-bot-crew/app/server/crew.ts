import "server-only";
import type { AgentInstance, FoundryActivationRecord, FoundryApproval } from "glove-foundry";
import { foundry, ownedAgents, type ApprovalView, type DisplayOptions, type ToolLabel } from "glove-foundry-web-kit/server";
import type { EventRoutine, ScheduledRoutine } from "../../lib/people";
import { host } from "./host";

// What the Crew screens read about a person: their bots and how each is
// doing, their group chats, and how tool calls, mail and approvals read in a
// chat. Everything is scoped to the signed-in person's workspace.

export interface Person {
  readonly id: string;
  readonly name: string;
}

export interface BotSummary {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly starred: boolean;
  readonly job?: string;
  /** `ask`: waiting for the person's approval. */
  readonly status: { readonly text: string; readonly busy: boolean; readonly ask?: boolean };
}

export interface GroupSummary {
  readonly id: string;
  readonly name: string;
  readonly members: ReadonlyArray<string>;
}

export const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("") || "?";

/** A person's name: the demo people by id, else what their bots call their owner. */
export async function personOf(id: string, bots?: ReadonlyArray<AgentInstance>): Promise<Person> {
  const demo = (await host()).people.MAYA;
  if (id === demo.id) return demo;
  const owner = (bots ?? await ownedAgents(id, "bot")).map((bot) => bot.context.owner).find((value) => typeof value === "string");
  return { id, name: typeof owner === "string" ? owner : id.charAt(0).toUpperCase() + id.slice(1) };
}

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** "Mondays 9:00", "Weekdays 8:30 · New York", "Every 2 hours". */
export function whenOf(timing: ScheduledRoutine["timing"] | FoundryActivationRecord["timing"]): string {
  const value = timing as { kind: string; expression?: string; timezone?: string; interval?: string; intervalMs?: number; at?: string };
  const zone = value.timezone && value.timezone !== "UTC" ? ` · ${value.timezone.split("/").at(-1)!.replaceAll("_", " ")}` : "";
  if (value.kind === "cron" && value.expression) {
    const [minute, hour, dom, month, dow] = value.expression.trim().split(/\s+/);
    if (/^\d+$/.test(minute ?? "") && /^\d+$/.test(hour ?? "") && dom === "*" && month === "*") {
      const time = `${Number(hour)}:${minute!.padStart(2, "0")}`;
      if (dow === "*") return `Daily ${time}${zone}`;
      if (dow === "1-5") return `Weekdays ${time}${zone}`;
      if (/^[0-6]$/.test(dow ?? "")) return `${DAYS[Number(dow)]} ${time}${zone}`;
    }
    return `${value.expression}${zone}`;
  }
  if (value.kind === "every") {
    const ms = value.intervalMs ?? 0;
    const hours = ms / 3_600_000;
    if (hours >= 1 && Number.isInteger(hours)) return hours === 1 ? "Every hour" : `Every ${hours} hours`;
    return value.interval ? `Every ${value.interval}` : `Every ${Math.round(ms / 60_000)} minutes`;
  }
  return value.at ? `Once, ${value.at}` : "Once";
}

/** A bot's routines: after an event (its data), on a schedule (carried as data, or its own schedules). */
export async function routinesOf(bot: AgentInstance, activations?: ReadonlyArray<FoundryActivationRecord>) {
  const events = ((bot.context.routines ?? []) as ReadonlyArray<EventRoutine>).map((routine) => ({
    when: routine.on === "new-mail" ? "On new mail" : `On ${routine.on}`,
    what: routine.skill ? `Run /${routine.skill}. ${routine.instruction}` : routine.instruction,
    kind: "event" as const,
  }));
  const carried = ((bot.context.schedules ?? []) as ReadonlyArray<ScheduledRoutine>).map((routine) => ({ when: whenOf(routine.timing), what: routine.message, kind: "schedule" as const }));
  const own = (activations ?? await foundry().activations(bot.workspaceId)).filter((item) =>
    item.agentId === bot.id && item.kind === "scheduled" && item.origin === "agent-tool" && item.timing.kind !== "at" &&
    item.status !== "completed" && item.status !== "cancelled");
  // A schedule carried as data is armed on the bot's next run, and then shows up as its own.
  const scheduled = own.map((item) => ({ when: whenOf(item.timing), what: item.message, kind: "schedule" as const }));
  return [...events, ...(scheduled.length > 0 ? scheduled : carried)];
}

/** The person's bots for the sidebar, with what each is doing. */
export async function botsOf(person: Pick<Person, "id">): Promise<{ readonly bots: BotSummary[]; readonly instances: ReadonlyArray<AgentInstance> }> {
  const client = foundry();
  const [instances, runs, activations, approvals] = await Promise.all([
    ownedAgents(person.id, "bot"), client.runs("bot"), client.activations(person.id), client.approvals({ status: "pending" }),
  ]);
  const active = runs.filter((run) => run.workspaceId === person.id && (run.status === "running" || run.status === "pending"));
  const bots = await Promise.all(instances.map(async (bot): Promise<BotSummary> => {
    const name = bot.name ?? "New bot";
    const run = active.find((item) => item.agentId === bot.id);
    const source = (run?.input as { source?: { kind?: string } } | undefined)?.source?.kind;
    const schedule = (await routinesOf(bot, activations)).find((routine) => routine.kind === "schedule");
    const waiting = approvals.some((approval) => approval.workspaceId === person.id && approval.agentId === bot.id);
    const status = waiting ? { text: "Waiting for your approval", busy: true, ask: true }
      : run ? { text: source === "mesh" ? "Working on a handoff" : source === "transmission" ? "Working on new mail" : "Working", busy: true }
      : !bot.description ? { text: "No job yet", busy: false }
      : bot.context.starred ? { text: "Primary Bot", busy: false }
      : schedule ? { text: `Routine ${schedule.when}`, busy: false }
      : { text: "Idle", busy: false };
    return {
      id: bot.id,
      name,
      initials: bot.description ? initials(name) : "?",
      starred: bot.context.starred === true,
      ...(bot.description ? { job: bot.description } : {}),
      status,
    };
  }));
  // The Primary Bot first, then the order they were made in.
  bots.sort((a, b) => Number(b.starred) - Number(a.starred));
  return { bots, instances };
}

/** The person's group chats: each member keeps a conversation whose data names the group. */
export async function groupsOf(instances: ReadonlyArray<AgentInstance>): Promise<GroupSummary[]> {
  const client = foundry();
  const found = new Map<string, { group: GroupSummary; at: string }>();
  for (const bot of instances) {
    for (const conversation of await client.conversations(bot.id)) {
      const group = conversation.context.group as { id?: string; name?: string; members?: string[] } | undefined;
      if (!group?.id || conversation.workspaceId !== bot.workspaceId) continue;
      const seen = found.get(group.id);
      if (!seen || conversation.updatedAt > seen.at) {
        found.set(group.id, { group: { id: group.id, name: group.name ?? group.id, members: group.members ?? [] }, at: conversation.updatedAt });
      }
    }
  }
  return [...found.values()].map((item) => item.group);
}

/** What the sidebar and header need. */
export async function crewOf(personId: string) {
  const { bots, instances } = await botsOf({ id: personId });
  const [person, groups] = await Promise.all([personOf(personId, instances), groupsOf(instances)]);
  return { person, bots, instances, groups };
}

// ── How a chat reads ────────────────────────────────────────────────────────

const decode = (text: string) => text.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&apos;", "'").replaceAll("&amp;", "&");

/** New mail and siblings' messages as one line each; other framework turns stay out. */
export function incoming(text: string): string | null {
  if (text.startsWith('<transmission direction="inbound"')) {
    const payload = /<payload format="json">([\s\S]*?)<\/payload>/.exec(text)?.[1];
    try {
      const mail = JSON.parse(decode(payload ?? "")) as { from?: string; subject?: string };
      const from = (mail.from ?? "someone").replace(/\s*<.*>$/, "");
      return `New mail from ${from}${mail.subject ? `: ${mail.subject}` : ""}`;
    } catch {
      return "New mail";
    }
  }
  const mesh = /^<mesh-message [^>]*name="([^"]*)"/.exec(text);
  if (mesh) return `Message from ${decode(mesh[1]!)}`;
  return null;
}

const APP_NAMES: Record<string, string> = { gmail: "Gmail", linear: "Linear" };

/** Tool calls as a person reads them. Inputs are read here, on the server; only the line is sent. */
export function describeTool(bots: ReadonlyArray<Pick<AgentInstance, "id" | "name">>): NonNullable<DisplayOptions["describeTool"]> {
  return (name, input): ToolLabel => {
    const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    if (name === "glove_mesh_send_message") {
      const to = bots.find((bot) => bot.id === args.to)?.name ?? "a sibling";
      return { label: `Handed to ${to} · its reply comes back here`, chip: true };
    }
    if (name === "execute_js") {
      const code = String(args.code ?? "");
      const apps = Object.keys(APP_NAMES).filter((app) => code.includes(`${app}.`)).map((app) => APP_NAMES[app]);
      return apps.length > 0 ? `Read ${apps.join(" and ")} in one program` : "Ran a program";
    }
    if (name.startsWith("glove_app_gmail__")) {
      const to = (args.payload as { to?: unknown } | undefined)?.to;
      return typeof to === "string" ? `Email to ${to}` : "Email";
    }
    const app = /^([a-z]+)__(.+)$/.exec(name);
    if (app && APP_NAMES[app[1]!]) return `${app[2]!.startsWith("save_") || app[2]!.startsWith("create_") ? "Wrote to" : "Read"} ${APP_NAMES[app[1]!]}`;
    const known: Record<string, string> = {
      glove_mesh_list_agents: "Looked up your bots",
      take_job: "Took the job",
      connect_app: "Asked to connect an app",
      save_skill: "Saved a skill",
      add_routine: "Added a routine",
      request_sign_in: "Asked you to sign in",
      glove_foundry_schedule: "Set a routine",
      glove_read_skill: "Read a skill",
    };
    return known[name];
  };
}

/** The display options for a bot's chat. */
export const chatDisplay = (bots: ReadonlyArray<Pick<AgentInstance, "id" | "name">>): DisplayOptions => ({ incoming, describeTool: describeTool(bots) });

// ── Approvals ───────────────────────────────────────────────────────────────

/** The installation "Always allow" writes to, if the tool is an app tool that may be always allowed. */
export function alwaysAllowable(approval: Pick<FoundryApproval, "toolName">, bot: AgentInstance | undefined) {
  const match = /^([a-z][a-z0-9-]*)__(.+)$/.exec(approval.toolName);
  if (!match || !bot) return undefined;
  const [, app, tool] = match as unknown as [string, string, string];
  const installation = bot.installations.find((item) => item.kind === "application" && item.id === app);
  const config = (installation?.config ?? {}) as { alwaysAsk?: string[] };
  if (!installation?.accountId || config.alwaysAsk?.includes(tool)) return undefined;
  return { app, tool, installation };
}

/** Titles and fields for the Crew approval card. */
export async function describeApprovals(person: Pick<Person, "id">, instances: ReadonlyArray<AgentInstance>) {
  const accounts = await (await host()).accounts.accountsOf(person.id);
  return (approval: FoundryApproval, view: ApprovalView): Partial<ApprovalView> => {
    const bot = instances.find((item) => item.id === approval.agentId);
    const who = bot?.name ?? "A bot";
    const input = (approval.toolInput ?? {}) as { routeId?: string; app?: string; site?: string; payload?: unknown };
    let title = `${who} wants to use ${approval.toolName.replaceAll("_", " ")}`;
    let fields = view.fields;
    if (approval.toolName.startsWith("glove_app_gmail__")) {
      title = `${who} wants to send this email`;
      const account = accounts.find((item) => input.routeId === `${item.id}-out`);
      fields = [...(account ? [{ label: "From", value: account.label ?? account.externalAccountId }] : []), ...view.fields];
    } else if (approval.toolName === "connect_app") {
      title = `${who} wants to connect ${APP_NAMES[String(input.app)] ?? String(input.app)}`;
    } else if (approval.toolName === "save_skill") {
      title = `${who} wants to save a skill`;
    } else if (approval.toolName === "request_sign_in") {
      title = `${who} needs you to sign in to ${String(input.site ?? "a site")}`;
    } else {
      const app = /^([a-z]+)__(.+)$/.exec(approval.toolName);
      if (app && APP_NAMES[app[1]!]) title = `${who} wants to ${app[2]!.replaceAll("_", " ")} in ${APP_NAMES[app[1]!]}`;
    }
    return { title, fields, canAlwaysAllow: Boolean(alwaysAllowable(approval, bot)) };
  };
}

/** An id for a new bot: the person's id and the next free number. Ids never change; names do. */
export function nextBotId(personId: string, instances: ReadonlyArray<Pick<AgentInstance, "id">>): string {
  for (let n = 1; ; n++) {
    const id = `${personId}-bot-${n}`;
    if (!instances.some((bot) => bot.id === id)) return id;
  }
}

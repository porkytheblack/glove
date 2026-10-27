import "server-only";
import type { AgentInstance, FoundryActivationRecord, FoundryApproval, FoundryRequest, FoundryRun, FoundryScheduleTiming } from "glove-foundry";
import {
  displayMessages,
  foundry,
  notFound,
  ownedAgent,
  ownedAgents,
  pendingApprovals,
  type ApprovalView,
  type DisplayMessage,
  type DisplayOptions,
  type ToolLabel,
} from "glove-foundry-web-kit/server";
import type { ParsedDot } from "../../lib/dot";
import { host } from "./host";

// What Dot's screens read about a person: their own dot and builder, the
// dot's app conversation, what it is doing, what waits on them, its
// follow-ups and files. Everything is scoped to the signed-in person's
// workspace. A specialist dot lives in its organisation's workspace, so it
// never shows here.

export interface Person {
  readonly id: string;
  readonly name: string;
}

export interface Team {
  readonly dot: AgentInstance;
  readonly data: ParsedDot;
  readonly builder?: AgentInstance;
}

const ACTIVE = new Set(["pending", "running"]);

/** The person's own dot and builder, or null when they have no dot yet. */
export async function teamOf(personId: string): Promise<Team | null> {
  const [dots, builders, { dots: model }] = await Promise.all([ownedAgents(personId, "dot"), ownedAgents(personId, "builder"), host()]);
  const primary = dots.filter((item) => item.context.kind !== "specialist");
  const dot = primary.find((item) => item.id === `${personId}-dot`) ?? primary[0];
  if (!dot) return null;
  const builder = builders.find((item) => item.id === `${personId}-builder`) ?? builders[0];
  return { dot, data: model.Dot.parse(dot.context), ...(builder ? { builder } : {}) };
}

/** The person's dot by id: theirs and a primary dot, or a 404. */
export async function ownedDot(personId: string, agentId: string): Promise<Team> {
  const agent = await ownedAgent(personId, agentId);
  const team = await teamOf(personId);
  if (!team || agent.id !== team.dot.id) throw notFound();
  return team;
}

/** The person: their name as their dot knows it. */
export function personOf(id: string, team: Team | null): Person {
  return { id, name: team?.data.owner ?? id.charAt(0).toUpperCase() + id.slice(1) };
}

/** The dot's conversation in the app, opened on first use. */
export async function appConversationOf(dot: AgentInstance): Promise<string> {
  const client = foundry();
  const existing = (await client.conversations(dot.id)).find((item) => item.context.conversationKey === "app" && item.workspaceId === dot.workspaceId);
  if (existing) return existing.id;
  return (await client.createConversation(dot.id, { id: `${dot.id}-app`, title: "App", context: { conversationKey: "app" } })).id;
}

// ── How the conversation reads ─────────────────────────────────────────────

const decode = (text: string) => text.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&apos;", "'").replaceAll("&amp;", "&");
const clip = (text: string, max = 90) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** New mail and the builder's replies as one line each; other framework turns stay out. */
export function incoming(names: { readonly gmail: string; readonly builder: string }) {
  return (text: string): string | null => {
    if (text.startsWith('<transmission direction="inbound"')) {
      const definition = /definition="([^"]+)"/.exec(text)?.[1];
      if (definition !== names.gmail) return "A message in Slack";
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
    if (mesh) return `${decode(mesh[1]!) === names.builder ? "The builder" : decode(mesh[1]!)} replied`;
    return null;
  };
}

/** Tool calls as a person reads them. Inputs are read here, on the server; only the line is sent. */
export function describeTool(names: { readonly sendTool: string; readonly gmailApp: string }): NonNullable<DisplayOptions["describeTool"]> {
  return (name, input): ToolLabel => {
    const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const text = (key: string) => (typeof args[key] === "string" ? args[key] as string : "");
    if (name === names.sendTool) {
      const to = (args.payload as { to?: unknown } | undefined)?.to;
      return typeof to === "string" ? `Email to ${to}` : "Email";
    }
    if (name === "glove_mesh_send_message") return { label: "Handed to the builder · its reply comes back here", chip: true };
    if (name === "execute_js") return text("code").includes("gmail.") ? "Read the mailbox in one program" : "Ran a program";
    if (name.startsWith(`${names.gmailApp}__`)) return name.endsWith("create_draft") ? "Drafted a reply" : "Read the mailbox";
    const known: Record<string, string> = {
      read_channel: `Read ${text("channel") || "a channel"}`,
      read_notes: "Read its notes",
      keep_note: "Kept a note",
      suggest: "Brought a suggestion",
      post_to_slack: "Posted in Slack",
      open_draft_pr: text("title") ? `Draft PR: ${text("title")}` : "Draft PR",
      merge_pr: typeof args.pr === "number" ? `Merge PR #${args.pr}` : "Merge a PR",
      change_password: "Change a password",
      glove_mesh_list_agents: "Looked for the builder",
      glove_foundry_schedule: "Set a follow-up",
      glove_foundry_schedules: "Checked its follow-ups",
      glove_foundry_spawn: "Split off some work",
      glove_context_set: "Remembered that",
      write_file: text("path") ? `Saved ${text("path")} on its computer` : "Saved a file on its computer",
      read_file: "Read a file on its computer",
    };
    return known[name];
  };
}

/** The display options for the dot's conversations and live runs. */
export async function displayOf(team: Team): Promise<DisplayOptions> {
  const { ids } = await host();
  return {
    incoming: incoming({ gmail: ids.gmail, builder: team.builder?.name ?? "Builder" }),
    describeTool: describeTool(ids),
  };
}

// ── Approvals ───────────────────────────────────────────────────────────────

/** Titles, fields and why it asks, for the dot's and the builder's approvals. */
export async function describeApprovals(personId: string, team: Team) {
  const { accounts, ids, review } = await host();
  const mine = await accounts.accountsOf(personId);
  return (approval: FoundryApproval, view: ApprovalView): Partial<ApprovalView> => {
    const who = approval.agentId === team.builder?.id ? team.builder?.name ?? "Builder" : team.dot.name ?? "Your dot";
    const input = (approval.toolInput ?? {}) as { routeId?: string; branch?: string; pr?: number };
    let title = `${who} wants to use ${approval.toolName.replaceAll("_", " ")}`;
    let fields = view.fields;
    let rule: string | undefined = approval.toolName;
    if (approval.toolName === ids.sendTool) {
      title = `${who} wants to send this email`;
      rule = "send_email";
      const account = mine.find((item) => input.routeId === `${item.id}-out`);
      fields = [...(account ? [{ label: "From", value: account.label ?? account.externalAccountId }] : []), ...view.fields];
    } else if (approval.toolName === "open_draft_pr") {
      title = `${who} wants to open a draft pull request`;
      if (typeof input.branch === "string") fields = [...fields, { label: "Branch", value: input.branch }];
    } else if (approval.toolName === "merge_pr") {
      title = `${who} wants to merge PR #${input.pr ?? "?"}`;
    } else if (approval.toolName.startsWith(`${ids.gmailApp}__`)) {
      title = `${who} wants to ${approval.toolName.slice(ids.gmailApp.length + 2).replaceAll("_", " ")} in Gmail`;
      rule = undefined;
    }
    const why = rule ? whyItAsks(rule, team.data.rules, review) : undefined;
    return { title, fields: [...fields, ...(why ? [{ label: "Why", value: why }] : [])] };
  };
}

type Review = Awaited<ReturnType<typeof host>>["review"];

function whyItAsks(rule: string, rules: ParsedDot["rules"], review: Review): string | undefined {
  if (review.ALWAYS_ASKS.has(rule)) return "Built-in safety: it always asks first.";
  switch (review.levelFor(rule, rules)) {
    case "ask": return "Your rule: ask first.";
    case "when_asked": return "Your rule: act when asked, and you didn't start this run.";
    case "allow": return rule === "send_email" ? "This address never wrote in, so it asks." : undefined;
    default: return undefined;
  }
}

/**
 * The pending approvals of the person's dot and builder, on runs still in
 * progress: a run that was redirected or cancelled can't use its approval.
 */
export async function approvalsOf(personId: string, team: Team, runs: ReadonlyArray<FoundryRun>, conversationId?: string): Promise<ApprovalView[]> {
  const agents = [team.dot.id, ...(team.builder ? [team.builder.id] : [])];
  const active = new Set(runs.filter((run) => ACTIVE.has(run.status)).map((run) => run.id));
  return pendingApprovals(personId, {
    filter: (approval) => agents.includes(approval.agentId) && active.has(approval.runId) && (!conversationId || approval.conversationId === conversationId),
    describe: await describeApprovals(personId, team),
  });
}

// ── Status ──────────────────────────────────────────────────────────────────

export interface DotStatus {
  readonly kind: "paused" | "researching" | "working" | "ready";
  readonly text: string;
}

/** The person's runs of their dot and builder, newest first. */
async function runsOf(personId: string, team: Team): Promise<FoundryRun[]> {
  const client = foundry();
  const [dotRuns, builderRuns] = await Promise.all([client.runs("dot"), team.builder ? client.runs("builder") : Promise.resolve([])]);
  const agents = [team.dot.id, ...(team.builder ? [team.builder.id] : [])];
  return [...dotRuns, ...builderRuns]
    .filter((run) => run.workspaceId === personId && run.agentId !== undefined && agents.includes(run.agentId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function statusOf(team: Team, runs: ReadonlyArray<FoundryRun>, activations: ReadonlyArray<FoundryActivationRecord>): Promise<DotStatus> {
  const { readOnly } = await host();
  if (team.data.paused) return { kind: "paused", text: "Paused, only reads" };
  const active = runs.filter((run) => run.agentId === team.dot.id && ACTIVE.has(run.status));
  if (active.some((run) => !readOnly(run.input as FoundryRequest, team.data))) return { kind: "working", text: "Working" };
  if (active.length > 0) return { kind: "researching", text: "Researching, read only" };
  const research = activations.find((item) => item.agentId === team.dot.id && item.scheduleName === "research" && item.status === "active");
  return { kind: "ready", text: research ? `Ready · researches ${whenOf(research.timing).toLowerCase()}` : "Ready" };
}

// ── Home: the app conversation ──────────────────────────────────────────────

export interface ChatState {
  readonly messages: ReadonlyArray<DisplayMessage>;
  readonly approvals: ReadonlyArray<ApprovalView>;
  /** The run in progress in the app conversation, to follow live. */
  readonly runId: string | null;
  readonly total: number;
  /** The latest suggestion the dot brought with `suggest` that the person hasn't answered. */
  readonly suggestion: string | null;
  readonly status: DotStatus;
}

interface RawMessage {
  readonly sender: "user" | "agent";
  readonly text: string;
  readonly tool_results?: ReadonlyArray<{ readonly tool_name: string; readonly result: { readonly status: string; readonly data?: unknown } }>;
}

const LATEST = 200;

/** Drops the agent's messages after the last thing it was sent: the run in progress replays them live. */
export function withoutTrailingReplies<T extends { readonly sender: string }>(messages: ReadonlyArray<T>): T[] {
  let end = messages.length;
  while (end > 0 && messages[end - 1]!.sender === "agent") end--;
  return messages.slice(0, end);
}

export async function chatState(personId: string, team: Team): Promise<ChatState> {
  const client = foundry();
  const conversationId = await appConversationOf(team.dot);
  const { research } = await host();
  const [{ page }, runs, activations, display] = await Promise.all([
    client.conversationTranscript(team.dot.id, conversationId, { offset: 0, limit: 1 }),
    runsOf(personId, team),
    client.activations(personId),
    displayOf(team),
  ]);
  const offset = Math.max(0, page.total - LATEST);
  const transcript = await client.conversationTranscript(team.dot.id, conversationId, { offset, limit: LATEST });

  // Scheduled runs post their message into the conversation as if typed: show them as what they are.
  const scheduled = new Map<string, string>([[research.message, "Research · read only"]]);
  for (const item of activations) {
    if (item.agentId !== team.dot.id || item.scheduleName === "research") continue;
    scheduled.set(item.message, (item.payload as { followUp?: unknown } | undefined)?.followUp === true ? `Follow-up · ${clip(item.message)}` : `Wake-up · ${clip(item.message)}`);
  }
  const messages = displayMessages(transcript, display).map((message): DisplayMessage => {
    if (message.sender === "person" && scheduled.has(message.text)) return { id: message.id, sender: "event", text: scheduled.get(message.text)! };
    // A run in progress streams its own tools live; one still "running" here was cut off.
    if (message.tools?.some((tool) => tool.status === "running")) {
      return { ...message, tools: message.tools.map((tool) => (tool.status === "running" ? { ...tool, status: "error" as const } : tool)) };
    }
    return message;
  });

  const runId = runs.find((run) => run.conversationId === conversationId && ACTIVE.has(run.status))?.id ?? null;
  const [approvals, status] = await Promise.all([approvalsOf(personId, team, runs, conversationId), statusOf(team, runs, activations)]);
  return {
    messages: runId ? withoutTrailingReplies(messages) : messages,
    approvals,
    runId,
    total: page.total,
    suggestion: latestSuggestion(transcript.messages as unknown as ReadonlyArray<RawMessage>, new Set(scheduled.keys())),
    status,
  };
}

/** The last suggestion in the transcript, unless the person has written since. */
function latestSuggestion(messages: ReadonlyArray<RawMessage>, scheduled: ReadonlySet<string>): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    const result = message.tool_results?.find((item) => item.tool_name === "suggest" && item.result.status === "success");
    const suggestion = (result?.result.data as { suggestion?: unknown } | undefined)?.suggestion;
    if (typeof suggestion === "string") return suggestion;
    const typed = message.sender === "user" && !message.tool_results?.length && !message.text.trimStart().startsWith("<") && !scheduled.has(message.text);
    if (typed) return null;
  }
  return null;
}

// ── Activity ────────────────────────────────────────────────────────────────

export interface RunLine {
  readonly id: string;
  readonly who: string;
  readonly what: string;
  readonly readOnly: boolean;
  readonly startedAt: string;
}

export interface FollowUp {
  readonly id: string;
  readonly what: string;
  readonly when: string;
  /** Acts under the person's rules, rather than only reading. */
  readonly acts: boolean;
}

export interface FileLine {
  readonly agentId: string;
  readonly owner: string;
  readonly path: string;
  readonly bytes: number;
  readonly modifiedAt: string;
}

export interface HandOffLine {
  readonly id: string;
  readonly action: string;
  readonly todo: string;
  readonly builtIn: boolean;
  readonly at: string;
}

export interface ActivityState {
  readonly paused: boolean;
  readonly status: DotStatus;
  readonly runs: ReadonlyArray<RunLine>;
  readonly approvals: ReadonlyArray<ApprovalView>;
  readonly handOffs: ReadonlyArray<HandOffLine>;
  readonly followUps: ReadonlyArray<FollowUp>;
  readonly files: ReadonlyArray<FileLine>;
}

const meshBody = (text: string) => /<mesh-message[^>]*>\n?([\s\S]*?)\n?<\/mesh-message>/.exec(text)?.[1] ?? text.replace(/<[^>]+>/g, " ");

/** What a run is doing, in a few words. Only this line reaches the page. */
async function whatOf(run: FoundryRun, team: Team, activations: ReadonlyArray<FoundryActivationRecord>): Promise<string> {
  const { ids } = await host();
  const input = (run.input ?? {}) as Partial<FoundryRequest>;
  const message = typeof input.message === "string" ? input.message : "";
  if (run.agentId === team.builder?.id) return clip(meshBody(message)) || "A job for your dot";
  switch (input.source?.kind) {
    case "activation": {
      const activation = activations.find((item) => item.id === input.source?.id);
      if (activation?.scheduleName === "research") return "Research";
      if (activation?.kind === "sleep") return "Waking up";
      return `Follow-up: ${clip(message)}`;
    }
    case "transmission":
      return input.source.provider === ids.gmail ? "Reading new mail" : "Answering you in Slack";
    case "mesh":
      return "Checking the builder's reply";
    case "spawn":
    case "background":
      return `Split off: ${clip(message)}`;
    default:
      return message.trimStart().startsWith("<") ? "Working" : clip(message) || "Your message";
  }
}

export async function activityState(personId: string, team: Team): Promise<ActivityState> {
  const client = foundry();
  const { computer, handoffs, readOnly } = await host();
  const [runs, activations, open] = await Promise.all([
    runsOf(personId, team),
    client.activations(personId),
    handoffs.openHandOffs([team.dot.id]),
  ]);
  const approvals = await approvalsOf(personId, team, runs);
  const active = runs.filter((run) => ACTIVE.has(run.status));
  const lines = await Promise.all(active.map(async (run): Promise<RunLine> => ({
    id: run.id,
    who: run.agentId === team.builder?.id ? team.builder?.name ?? "Builder" : team.dot.name ?? "Your dot",
    what: await whatOf(run, team, activations),
    readOnly: run.agentId === team.dot.id && readOnly(run.input as FoundryRequest, team.data),
    startedAt: run.startedAt ?? run.createdAt,
  })));

  const followUps = activations
    .filter((item) => item.agentId === team.dot.id && item.workspaceId === personId && item.status !== "completed" && item.status !== "cancelled")
    .map((item): FollowUp => {
      const acts = (item.payload as { followUp?: unknown } | undefined)?.followUp === true;
      const what = item.scheduleName === "research" ? "Research" : item.kind === "sleep" ? "Wake-up" : clip(item.message, 120);
      return { id: item.id, what, when: `${whenOf(item.timing)}${item.status === "paused" ? " · paused" : ""}`, acts };
    })
    // Follow-ups that act first, research last.
    .sort((a, b) => Number(b.acts) - Number(a.acts));

  const owners = [team.dot, ...(team.builder ? [team.builder] : [])];
  const files = (await Promise.all(owners.map(async (agent) =>
    (await computer.computerFiles(agent)).map((file): FileLine => ({ agentId: agent.id, owner: agent.name ?? agent.id, ...file }))))).flat();

  return {
    paused: team.data.paused,
    status: await statusOf(team, runs, activations),
    runs: lines,
    approvals,
    handOffs: open.map(({ id, action, todo, builtIn, at }) => ({ id, action, todo, builtIn, at })),
    followUps,
    files,
  };
}

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const city = (zone: string) => zone.split("/").at(-1)!.replaceAll("_", " ");

/** "Mondays 9:00, New York", "Every 2 hours", "Tue, Oct 28, 10:00 AM". */
export function whenOf(timing: FoundryScheduleTiming): string {
  if (timing.kind === "every") {
    const hours = timing.intervalMs / 3_600_000;
    if (hours >= 1 && Number.isInteger(hours)) return hours === 1 ? "Every hour" : `Every ${hours} hours`;
    return `Every ${Math.max(1, Math.round(timing.intervalMs / 60_000))} minutes`;
  }
  if (timing.kind === "cron") {
    const zone = timing.timezone && timing.timezone !== "UTC" ? `, ${city(timing.timezone)}` : timing.timezone === "UTC" ? " UTC" : "";
    const [minute, hour, dom, month, dow] = timing.expression.trim().split(/\s+/);
    if (/^\d+$/.test(minute ?? "") && /^\d+$/.test(hour ?? "") && dom === "*" && month === "*") {
      const time = `${Number(hour)}:${minute!.padStart(2, "0")}`;
      if (dow === "*") return `Daily ${time}${zone}`;
      if (dow === "1-5") return `Weekdays ${time}${zone}`;
      if (/^[0-6]$/.test(dow ?? "")) return `${DAYS[Number(dow)]} ${time}${zone}`;
    }
    return `${timing.expression}${zone}`;
  }
  const at = new Date(timing.at);
  return Number.isNaN(at.getTime()) ? "Once" : `Once, ${at.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

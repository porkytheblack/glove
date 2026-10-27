import "server-only";
import type { AgentInstance, FoundryActivationRecord } from "glove-foundry";
import {
  displayMessages,
  foundry,
  ownedAgent,
  pendingApprovals,
  type ApprovalView,
  type DisplayMessage,
  type DisplayOptions,
  type ToolLabel,
} from "glove-foundry-web-kit/server";
import { host } from "./host";

// What Muse's screens read about the signed-in person: their Muse, its chat
// and what waits for their yes, its browser, its plans and log, what it
// remembers and what it may do. Everything comes from the person's own
// workspace, and the page gets display shapes only: no session or profile
// ids, no live-view link that takes input, no raw tool input or results.

export interface Persona {
  /** What they call their agent. */
  readonly name: string;
  /** A colour key (ui/look.ts). */
  readonly avatar: string;
  readonly style: string;
  /** The person's own name. */
  readonly person: string;
}

/** The person's Muse. A 404 if they have none. */
export async function museOf(personId: string): Promise<AgentInstance> {
  const { people } = await host();
  return ownedAgent(personId, people.museId(personId));
}

export function personaOf(muse: AgentInstance): Persona {
  const persona = (muse.context.persona ?? {}) as { readonly avatar?: unknown; readonly style?: unknown };
  return {
    name: muse.name ?? "Muse",
    avatar: typeof persona.avatar === "string" ? persona.avatar : "green",
    style: typeof persona.style === "string" ? persona.style : "",
    person: typeof muse.context.name === "string" ? muse.context.name : muse.workspaceId,
  };
}

const record = (value: unknown): Readonly<Record<string, unknown>> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** A site as a host, from what Muse wrote ("bistro-luna.example", or a URL). */
export function hostOf(site: string): string {
  try {
    return new URL(site.includes("://") ? site : `https://${site}`).host;
  } catch {
    return site;
  }
}

/** Host and path of a page: a query string can carry data, so it stays out. */
function where(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return null;
  }
}

/** Its browser as the instance keeps it. Only the view-only link ever leaves the server. */
function browserOf(muse: AgentInstance): { readonly sessionId?: string; readonly watchUrl?: string } {
  return record(muse.context.browser) as { sessionId?: string; watchUrl?: string };
}

// ── The chat ────────────────────────────────────────────────────────────────

/** The id of one of Muse's two conversations; the app one is opened on first use. */
export async function conversationOf(muse: AgentInstance, key: "app" | "whatsapp"): Promise<string> {
  const { people } = await host();
  const options = people.channel(muse.id, key);
  if (key === "whatsapp") return options.id!;
  const existing = (await foundry().conversations(muse.id)).find((item) => item.id === options.id);
  if (existing) return existing.id;
  return (await foundry().createConversation(muse.id, options)).id;
}

const decode = (text: string) => text.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&apos;", "'").replaceAll("&amp;", "&");

/** New mail in the app conversation, as one line; other framework turns stay out. */
function incoming(text: string): string | null {
  if (!text.startsWith('<transmission direction="inbound"')) return null;
  const payload = /<payload format="json">([\s\S]*?)<\/payload>/.exec(text)?.[1];
  try {
    const event = JSON.parse(decode(payload ?? "")) as { from?: string; subject?: string; text?: string };
    if (event.subject !== undefined || event.from?.includes("@")) {
      return `New mail from ${(event.from ?? "someone").replace(/\s*<.*>$/, "")}${event.subject ? `: ${event.subject}` : ""}`;
    }
    return "A message came in";
  } catch {
    return "Something came in";
  }
}

/** Tool calls as Rosa reads them. Inputs are read here; only the line is sent. */
export async function describeTool(): Promise<NonNullable<DisplayOptions["describeTool"]>> {
  const { toolNames } = await host();
  return (name, input): ToolLabel => {
    const args = record(input);
    if (name === "execute_js") {
      const code = String(args.code ?? "");
      const apps = [code.includes("gmail.") ? "Gmail" : "", code.includes("calendar.") ? "Calendar" : ""].filter(Boolean);
      return apps.length > 0 ? `Read ${apps.join(" and ")} in one program` : "Ran a program";
    }
    if (name === "execute_browser") {
      const code = String(args.code ?? "");
      if (code.includes("browser.handOff")) return { label: "Handed you its browser to sign in", chip: true };
      const url = /navigate\(\{[^}]*url:\s*["'`]([^"'`]+)["'`]/.exec(code)?.[1];
      if (url) return `Opened ${hostOf(url)} in its browser`;
      return code.includes("browser.close") ? "Closed its browser" : "Used its browser";
    }
    if (name === "request_access") return `Asked the Sentinel about ${hostOf(String(args.site ?? "a site"))}`;
    if (name === "buy") return `Paid ${String(args.merchant ?? "at a checkout")}`;
    if (name === toolNames.gmailSend) {
      const to = record(args.payload).to;
      return typeof to === "string" ? `Email to ${to}` : "Email";
    }
    if (name === toolNames.whatsappSend) return "Wrote to you on WhatsApp";
    const known: Record<string, string> = {
      glove_context_set: "Remembered that",
      glove_context_unset: "Forgot it",
      glove_context_get: "Looked at what it remembers",
      glove_goal_start: "Made a plan",
      glove_goal_revise: "Changed a plan",
      glove_goal_update: "Updated a plan",
      glove_foundry_schedule: "Set itself a check",
      glove_foundry_sleep: "Set itself a reminder",
    };
    return known[name];
  };
}

/** Its own checks show as a line, not as something the person said. */
function asChecks(messages: ReadonlyArray<DisplayMessage>, activations: ReadonlyArray<FoundryActivationRecord>): DisplayMessage[] {
  const checks = new Set(activations.map((item) => item.message.trim()));
  return messages.flatMap((message): DisplayMessage[] => {
    if (message.sender === "person" && checks.has(message.text.trim())) {
      return [{ ...message, sender: "event", text: `Its own check: ${firstSentence(message.text)}` }];
    }
    // A suggestion pass with nothing to suggest says so to no one.
    if (message.sender === "agent" && message.text.trim() === "(nothing to suggest)" && !message.tools?.length) return [];
    return [message];
  });
}

/** A pending approval, with what the Sentinel card needs when it is the Sentinel asking. */
export interface MuseApproval extends ApprovalView {
  readonly sentinel?: {
    readonly site: string;
    readonly access: "read" | "write";
    readonly why: string;
    /** Whether she already lets Muse read the site. */
    readonly readAllowed: boolean;
  };
  /** Asked while Muse worked on WhatsApp. */
  readonly onWhatsApp?: boolean;
}

/** Muse's pending approvals, from either conversation. */
export async function approvalsOf(personId: string, muse: AgentInstance): Promise<MuseApproval[]> {
  const { accounts, people, rulesOf, toolNames } = await host();
  const rules = rulesOf(muse.context);
  const mine = await accounts.accountsOf(personId);
  const whatsapp = people.channel(muse.id, "whatsapp").id;
  const name = muse.name ?? "Muse";
  const extras = new Map<string, Partial<MuseApproval>>();
  const views = await pendingApprovals(personId, {
    filter: (approval) => approval.agentId === muse.id,
    describe: (approval, view) => {
      const input = record(approval.toolInput);
      const extra: { -readonly [K in keyof MuseApproval]?: MuseApproval[K] } = approval.conversationId === whatsapp ? { onWhatsApp: true } : {};
      extras.set(approval.id, extra);
      if (approval.toolName === "request_access") {
        const site = hostOf(String(input.site ?? ""));
        extra.sentinel = {
          site,
          access: input.access === "read" ? "read" : "write",
          why: clip(String(input.why ?? ""), 300),
          readAllowed: rules.read.includes(site) || rules.write.includes(site),
        };
        return { title: "The Sentinel asks", fields: [] };
      }
      if (approval.toolName === toolNames.gmailSend) {
        const account = mine.find((item) => input.routeId === `${item.id}-out`);
        return {
          title: `${name} wants to send this email`,
          fields: [...(account ? [{ label: "From", value: account.label ?? account.externalAccountId }] : []), ...view.fields],
        };
      }
      if (approval.toolName === "buy") {
        const cents = Number(input.amountCents);
        const items = Array.isArray(input.items) ? input.items.filter((item): item is string => typeof item === "string") : [];
        return {
          title: `${name} wants to pay ${String(input.merchant ?? "a shop")}`,
          fields: [
            ...(Number.isFinite(cents) ? [{ label: "Amount", value: `$${(cents / 100).toFixed(2)}` }] : []),
            ...(items.length > 0 ? [{ label: "Items", value: clip(items.join(", "), 300) }] : []),
            ...(typeof input.site === "string" ? [{ label: "Site", value: input.site }] : []),
          ],
        };
      }
      return { title: `${name} wants to use ${approval.toolName.replaceAll("_", " ")}` };
    },
  });
  return views.map((view) => {
    const extra = extras.get(view.id) ?? {};
    // A Sentinel card shows the site and the reason itself.
    const { body: _body, ...rest } = view;
    return extra.sentinel ? { ...rest, ...extra } : { ...view, ...extra };
  });
}

/** Muse's runs in progress, in either conversation. */
async function activeRuns(personId: string, muse: AgentInstance) {
  return (await foundry().runs("muse")).filter((run) =>
    run.workspaceId === personId && run.agentId === muse.id && (run.status === "running" || run.status === "pending"));
}

/** Drops the agent's messages after the last thing it was sent: the run in progress streams them again. */
export function withoutTrailingReplies<T extends { readonly sender: string }>(messages: ReadonlyArray<T>): T[] {
  let end = messages.length;
  while (end > 0 && messages[end - 1]!.sender === "agent") end--;
  return messages.slice(0, end);
}

/** A hand-off waiting for the person, if its browser is still the one Muse keeps. Host-side only. */
export async function pendingHandOff(personId: string, muse: AgentInstance) {
  const { handoffs } = await host();
  const handOff = await handoffs.handOffOf(personId);
  if (!handOff || handOff.agentId !== muse.id || handOff.sessionId !== browserOf(muse).sessionId) return undefined;
  return handOff;
}

/** What the page may know of a hand-off: the site and the reason. */
const handOffView = (handOff: { readonly reason: string; readonly page: { readonly url: string } }) =>
  ({ site: where(handOff.page.url)?.split("/")[0] ?? "A site", reason: handOff.reason });

export interface ChatState {
  readonly messages: ReadonlyArray<DisplayMessage>;
  readonly approvals: ReadonlyArray<MuseApproval>;
  /** The run in progress in the app conversation, to follow live. */
  readonly runId: string | null;
  readonly total: number;
  /** The line under its name. */
  readonly status: string;
  readonly handOff: { readonly site: string; readonly reason: string } | null;
  /** She reaches it on WhatsApp too. */
  readonly whatsapp: boolean;
}

const LATEST = 200;

function statusLine(active: number, approvals: number, handOff: boolean): string {
  if (handOff) return "Waiting for you to sign in";
  if (approvals > 0) return approvals === 1 ? "Waiting for your yes" : `${approvals} things wait for your yes`;
  if (active > 0) return active === 1 ? "Working on 1 errand" : `Working on ${active} errands`;
  return "Ready when you are";
}

/** The app conversation: the latest messages, what waits for her, and the run in progress. */
export async function chatState(personId: string): Promise<ChatState> {
  const muse = await museOf(personId);
  const conversationId = await conversationOf(muse, "app");
  const client = foundry();
  const { page } = await client.conversationTranscript(muse.id, conversationId, { offset: 0, limit: 1 });
  const offset = Math.max(0, page.total - LATEST);
  const [transcript, approvals, runs, activations, handOff, describe] = await Promise.all([
    client.conversationTranscript(muse.id, conversationId, { offset, limit: LATEST }),
    approvalsOf(personId, muse),
    activeRuns(personId, muse),
    client.activations(personId),
    pendingHandOff(personId, muse),
    describeTool(),
  ]);
  const messages = asChecks(displayMessages(transcript, { incoming, describeTool: describe }), activations.filter((item) => item.workspaceId === personId));
  const runId = runs.filter((run) => run.conversationId === conversationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id ?? null;
  return {
    // The run in progress replays from its start on the live stream, so its replies so far come from there.
    messages: runId ? withoutTrailingReplies(messages) : messages,
    approvals,
    runId,
    total: page.total,
    status: statusLine(runs.length, approvals.length, Boolean(handOff)),
    handOff: handOff ? handOffView(handOff) : null,
    whatsapp: typeof muse.context.phone === "string",
  };
}

// ── Watch ───────────────────────────────────────────────────────────────────

export interface WatchState {
  readonly name: string;
  /** Muse has a browser open (or kept). */
  readonly open: boolean;
  /** The view-only live view, when it can be embedded (https). */
  readonly view: string | null;
  /** The page it is on, host and path, when known. */
  readonly page: string | null;
  readonly caption: string | null;
  readonly handOff: { readonly site: string; readonly reason: string } | null;
}

/** The last page the Sentinel let the browser load since it opened. */
function lastPage(entries: ReadonlyArray<{ readonly kind: string; readonly what: string; readonly outcome: string }>): string | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.kind === "browser" && entry.what === "opened a browser") return null;
    if (entry.kind === "sentinel" && entry.outcome === "allow" && entry.what.startsWith("GET ")) return entry.what.slice(4).replace(/\/$/, "");
  }
  return null;
}

export async function watchState(personId: string): Promise<WatchState> {
  const muse = await museOf(personId);
  const { activity } = await host();
  const browser = browserOf(muse);
  const open = Boolean(browser.sessionId);
  const [handOff, runs, log] = await Promise.all([pendingHandOff(personId, muse), activeRuns(personId, muse), open ? activity.activityOf(personId) : []]);
  const name = muse.name ?? "Muse";
  const view = open && typeof browser.watchUrl === "string" && browser.watchUrl.startsWith("https://") ? browser.watchUrl : null;
  return {
    name,
    open,
    view,
    page: handOff ? where(handOff.page.url) : open ? lastPage(log) : null,
    caption: handOff ? `Waiting for you: ${handOff.reason}` : !open ? null : runs.length > 0 ? `${name} is using it now` : "Kept open for its next errand",
    handOff: handOff ? handOffView(handOff) : null,
  };
}

// ── Plans and the log ───────────────────────────────────────────────────────

export interface PlanView {
  readonly key: string;
  readonly title: string;
  readonly done: number;
  readonly total: number;
  readonly steps: ReadonlyArray<{ readonly key: string; readonly label: string; readonly state: "done" | "next" | "todo" | "later" | "skipped" }>;
}

export interface PlansState {
  readonly plans: ReadonlyArray<PlanView>;
  readonly planned: ReadonlyArray<string>;
  /** What it did, newest first: a time and a line. */
  readonly done: ReadonlyArray<{ readonly at: string; readonly text: string }>;
}

const firstSentence = (text: string) => clip((/^[^.!?\n]*[.!?]?/.exec(text.trim())?.[0] ?? text).replace(/[.!?]$/, ""), 120);

/** "every 6 hours", "daily 9:00", "Fri 19:00". */
function whenOf(timing: FoundryActivationRecord["timing"]): string {
  const value = timing as { kind: string; expression?: string; intervalMs?: number; at?: string };
  if (value.kind === "every") {
    const hours = (value.intervalMs ?? 0) / 3_600_000;
    if (hours === 24) return "each day";
    if (hours >= 1 && Number.isInteger(hours)) return hours === 1 ? "every hour" : `every ${hours} hours`;
    return `every ${Math.max(1, Math.round((value.intervalMs ?? 0) / 60_000))} minutes`;
  }
  if (value.kind === "cron" && value.expression) {
    const [minute, hour, dom, month, dow] = value.expression.trim().split(/\s+/);
    if (/^\d+$/.test(minute ?? "") && /^\d+$/.test(hour ?? "") && dom === "*" && month === "*") {
      const time = `${Number(hour)}:${minute!.padStart(2, "0")}`;
      return dow === "*" ? `daily at ${time}` : dow === "1-5" ? `weekdays at ${time}` : `at ${time}, ${value.expression}`;
    }
    return `on a schedule (${value.expression})`;
  }
  return value.at ? `at ${new Date(value.at).toUTCString().slice(0, 22)}` : "once";
}

const PLAN_STATE = { done: "done", declined: "skipped", deferred: "later", pending: "todo" } as const;

/** One line per thing it did that she would want to know, from its log. Details stay on the server. */
function doneLine(entry: { readonly kind: string; readonly what: string; readonly outcome: string; readonly detail?: string }, tools: { readonly gmailSend: string; readonly whatsappSend: string }): string | null {
  const detail = entry.detail ?? "";
  const field = (key: string) => new RegExp(`"${key}":"([^"]{1,120})"`).exec(detail)?.[1];
  if (entry.kind === "sentinel") {
    const site = entry.what.split(" ")[1]?.split("/")[0] ?? entry.what;
    if (entry.outcome === "block") return `The Sentinel blocked ${site}`;
    if (entry.outcome === "ask") return `The Sentinel asked you about ${site}`;
    if (entry.outcome === "the person allowed it") return `You allowed ${entry.what.replace(/^allow /, "")}`;
    return null;
  }
  if (entry.kind === "browser") {
    if (entry.what === "opened a browser") return "Opened its browser";
    if (entry.what.startsWith("handed the browser over")) return "Handed you its browser to sign in";
    return null;
  }
  const ok = entry.outcome === "success";
  switch (entry.what) {
    case tools.gmailSend: return ok ? `Emailed ${field("to") ?? "someone"}, after your yes` : null;
    case tools.whatsappSend: return ok ? "Wrote to you on WhatsApp" : null;
    case "buy": return ok ? `Paid ${field("merchant") ?? "a shop"}, after your yes` : `Didn't pay ${field("merchant") ?? "a shop"}`;
    case "execute_js": return ok ? "Read your apps" : null;
    case "glove_context_set": return ok ? "Remembered something you said" : null;
    case "glove_context_unset": return ok ? "Forgot something, as you asked" : null;
    case "glove_goal_start": return ok ? "Made a plan" : null;
    case "glove_goal_revise": return ok ? "Changed a plan" : null;
    case "glove_goal_update": return ok ? "Moved a plan along" : null;
    case "glove_foundry_schedule": return ok ? "Set itself a check" : null;
    case "glove_foundry_sleep": return ok ? "Set itself a reminder" : null;
    default: return null;
  }
}

export async function plansState(personId: string): Promise<PlansState> {
  const muse = await museOf(personId);
  const { activity, toolNames } = await host();
  const [plans, activations, approvals, log] = await Promise.all([
    activity.plansOf(personId),
    foundry().activations(personId),
    approvalsOf(personId, muse),
    activity.activityOf(personId),
  ]);

  const views: PlanView[] = plans.map((plan) => {
    let next = plan.status === "active";
    const steps = plan.steps.map((step) => {
      const base = PLAN_STATE[step.state as keyof typeof PLAN_STATE] ?? "todo";
      const state = base === "todo" && next ? "next" as const : base;
      if (state === "next") next = false;
      return { key: step.key, label: step.label, state };
    });
    return { key: plan.key, title: plan.title, done: steps.filter((step) => step.state === "done").length, total: steps.length, steps };
  });

  const planned = [
    ...activations.filter((item) => item.workspaceId === personId && item.agentId === muse.id && item.status === "active").map((item) =>
      item.scheduleName === "suggest" || item.message.startsWith("Suggestion pass") ? "A suggestion each day, if one would help" : `${firstSentence(item.message)}, ${whenOf(item.timing)}`),
    ...views.flatMap((plan) => plan.steps.filter((step) => step.state === "next").map((step) => `Next plan step: ${step.label}`)),
    ...approvals.map((approval) => `Waiting for your yes: ${approval.sentinel ? `${approval.sentinel.access === "read" ? "reading" : "sending to"} ${approval.sentinel.site}` : approval.title.replace(/^\S+ wants to /, "")}`),
  ];

  // The last day and a half; the page keeps what falls on the person's own today.
  const since = Date.now() - 36 * 60 * 60 * 1000;
  const done: Array<{ at: string; text: string }> = [];
  for (const entry of log) {
    if (Date.parse(entry.at) < since) continue;
    const text = doneLine(entry, toolNames);
    if (text && done.at(-1)?.text !== text) done.push({ at: entry.at, text });
  }
  return { plans: views, planned, done: done.reverse().slice(0, 60) };
}

// ── You and Connections ─────────────────────────────────────────────────────

/** What it remembers, as lines with the ids Forget needs. */
export async function memoriesOf(personId: string, muse: AgentInstance) {
  const { memoryOf } = await host();
  const entries = await memoryOf(personId, muse.id).list().catch(() => []);
  return entries
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((entry) => ({ id: entry.id, text: clip((entry.content.trim().split("\n")[0] || entry.title || entry.section).replace(/^[#>*\-\s]+/, ""), 160) }));
}

export type AppKey = "gmail" | "calendar";
export const APP_NAMES: Record<AppKey, string> = { gmail: "Gmail", calendar: "Google Calendar" };

export interface ConnectionsState {
  readonly apps: ReadonlyArray<{ readonly app: AppKey; readonly name: string; readonly account: string | null; readonly access: "read" | "act" | null }>;
  /** Her WhatsApp number, written out. */
  readonly whatsapp: string | null;
  readonly sites: ReadonlyArray<{ readonly site: string; readonly access: "send" | "read" | "blocked" }>;
}

/** "+1 555 010 1234" from "15550101234". */
export function phoneOf(digits: string): string {
  if (/^1\d{10}$/.test(digits)) return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return `+${digits}`;
}

export async function connectionsState(personId: string, muse: AgentInstance): Promise<ConnectionsState> {
  const { accounts, connect, rulesOf } = await host();
  const mine = await accounts.accountsOf(personId);
  const rules = rulesOf(muse.context);
  const apps = (Object.keys(APP_NAMES) as AppKey[]).map((app) => {
    const account = mine.find((item) => item.app === app);
    const installed = muse.installations.find((item) => item.kind === "application" && item.id === connect.APPS[app].id && item.accountId === account?.id);
    const access = installed ? ((installed.config as { access?: string } | undefined)?.access === "act" ? "act" as const : "read" as const) : null;
    return { app, name: APP_NAMES[app], account: account ? account.label ?? account.externalAccountId : null, access };
  });
  const sites = [
    ...rules.write.map((site) => ({ site, access: "send" as const })),
    ...rules.read.filter((site) => !rules.write.includes(site)).map((site) => ({ site, access: "read" as const })),
    ...rules.blocked.map((site) => ({ site, access: "blocked" as const })),
  ];
  return { apps, whatsapp: typeof muse.context.phone === "string" ? phoneOf(muse.context.phone) : null, sites };
}

import { Effect } from "effect";
import { choice, llmClassifier, type ClassifierAdapter } from "glove-classifier";
import type { KuiperBrowserRequest } from "glove-execution/kuiper";
import type { AgentAssemblyContext } from "glove-foundry";
import { z } from "zod";
import { logActivity } from "../../lib/activity.js";
import { claudeModel, hasModelKey } from "../../lib/claude.js";
import whatsapp from "./transmissions/whatsapp.transmission.js";

/**
 * The Sentinel. Nothing Muse's browser sends leaves unless the Sentinel lets
 * it: glove-execution/kuiper calls `guard` for every request the browser
 * makes while Muse is connected (pages, form posts, a page's own fetches,
 * WebSockets), outside the page and outside Muse's model, before it leaves.
 *
 * It is kept apart from Muse on purpose. It never sees Muse's conversation,
 * its reasoning or the pages it read, so a page that tells Muse what to do
 * cannot talk the Sentinel round. It sees the request, what the person asked
 * for in this run (their own words), and the sites they have allowed.
 *
 * Three answers: allow, block, or ask the person. When it asks, Muse puts the
 * question to them with request_access; only their approval adds a site to
 * what Muse may do. Reading a site and sending to it are separate grants, so
 * letting Muse read a site doesn't let it post there.
 */

export type Verdict = "allow" | "ask" | "block";

export interface SentinelRules {
  /** Sites the person let Muse read (GET, HEAD), by host. */
  readonly read: ReadonlyArray<string>;
  /** Sites the person let Muse send to (forms, posts, WebSockets), by host. Sending implies reading. */
  readonly write: ReadonlyArray<string>;
  /** Sites the person never wants reached, by host. */
  readonly blocked: ReadonlyArray<string>;
}

export type Grant = "read" | "write";

export interface Decision {
  readonly verdict: Verdict;
  readonly reason: string;
  readonly method: string;
  /** Host and path only: a query string can carry data. */
  readonly target: string;
}

export function rulesOf(context: Readonly<Record<string, unknown>>): SentinelRules {
  const rules = context.sentinel as Partial<SentinelRules> | undefined;
  return { read: [...(rules?.read ?? [])], write: [...(rules?.write ?? [])], blocked: [...(rules?.blocked ?? [])] };
}

/**
 * Personal details in a URL: an email address anywhere in it, or a query value
 * that is a phone number. Long numbers in a path are usually ids, so they pass.
 */
export function personalDataIn(url: URL): string | undefined {
  const raw = `${url.pathname}${url.search}`;
  let text = raw;
  try { text = decodeURIComponent(raw); } catch { /* a malformed escape: check it as written */ }
  if (/[\w.+-]+@[\w-]+(\.[\w-]+)+/.test(text)) return "an email address";
  for (const value of url.searchParams.values()) {
    if (/^\+?[\d ()-]{10,20}$/.test(value) && value.replace(/\D/g, "").length >= 10) return "a phone number";
  }
  return undefined;
}

const READS = new Set(["GET", "HEAD"]);

/** The grant a request needs: reads need either, anything else needs write. */
const grantFor = (method: string): Grant => (READS.has(method) ? "read" : "write");
const granted = (rules: SentinelRules, host: string, method: string) =>
  rules.write.includes(host) || (grantFor(method) === "read" && rules.read.includes(host));

/** The model never lets a send through on its own: without a write grant, the person decides. */
const writesWithoutGrant = (method: string, decided: Omit<Decision, "method" | "target">): Omit<Decision, "method" | "target"> =>
  decided.verdict === "allow" && grantFor(method) === "write"
    ? { verdict: "ask", reason: `it would send to a site you haven't allowed sending to` }
    : decided;

/**
 * The Sentinel's own model, separate from Muse's: on Kuiper through its model
 * gateway, otherwise with ANTHROPIC_API_KEY or OPENROUTER_API_KEY. It is a small model answering one
 * typed question. Without either, a fixed rule stands in: reads pass,
 * anything that writes asks.
 */
function sentinelModel(): ClassifierAdapter | undefined {
  if (process.env.MUSE_DEMO === "1") return undefined;
  if (!hasModelKey()) return undefined;
  return llmClassifier({ model: claudeModel(process.env.SENTINEL_MODEL ?? "claude-haiku-5-5") });
}
let model: ClassifierAdapter | undefined | null = null;

async function judge(method: string, url: URL, asked: string | undefined, rules: SentinelRules): Promise<Omit<Decision, "method" | "target">> {
  if (model === null) model = sentinelModel();
  if (!model) {
    return READS.has(method)
      ? { verdict: "allow", reason: "it only reads a public page" }
      : { verdict: "ask", reason: `it would ${method} to ${url.host}, which you haven't allowed` };
  }
  const { answers } = await model.classify({
    state: {
      request: `${method} ${url.origin}${url.pathname}`,
      the_person_asked: asked ?? "(nobody: Muse is working on its own)",
      sites_the_person_allowed_reading: [...rules.read],
      sites_the_person_allowed_sending_to: [...rules.write],
    },
    questions: {
      verdict: choice("Should this request leave the person's agent browser?", {
        allow: "It plainly serves what the person asked: reading a public page, or using a site they allowed.",
        ask: "It may serve the request but changes something, pays, signs up or goes somewhere new. The person should decide.",
        block: "It does not serve what the person asked, or sends their data somewhere they never used.",
      }),
    },
  });
  const answer = answers.verdict;
  // Unsure is not yes: a doubtful allow goes to the person.
  const verdict: Verdict = answer.choice === "allow" && answer.confidence < 0.7 ? "ask" : answer.choice;
  return { verdict, reason: `the Sentinel judged it ${verdict} (${Math.round(answer.confidence * 100)}% sure)` };
}

export class Sentinel {
  /** What it said this run, by host, so request_access knows what is being asked. */
  private readonly decisions = new Map<string, Decision>();
  /** Pages it let Muse read this run, by host: a second look needs no second decision. */
  private readonly read = new Set<string>();
  /** Sites the person approved a purchase at, for this run only. */
  private readonly purchases = new Set<string>();
  private current?: Promise<SentinelRules>;

  constructor(private readonly ctx: Pick<AgentAssemblyContext, "agentId" | "workspaceId" | "agentInstance" | "data" | "request" | "messageText">) {}

  /** The person's words, when the person started this run. New mail and schedules are not them. */
  private asked(): string | undefined {
    const source = this.ctx.request.source;
    if (source?.kind === "direct") return this.ctx.messageText;
    if (source?.kind === "transmission" && source.provider === whatsapp.id) return this.ctx.messageText;
    return undefined;
  }

  /** The rules as they are now, read once a run; request_access updates them when the person allows a site. */
  private rules(): Promise<SentinelRules> {
    return this.current ??= Effect.runPromise(this.ctx.data.getAgent(this.ctx.agentId))
      .then((current) => rulesOf(current?.context ?? this.ctx.agentInstance.context));
  }

  allowed(host: string, grant: Grant, rules: SentinelRules): void {
    this.current = Promise.resolve({ ...rules, [grant]: [...new Set([...rules[grant], host])] });
  }

  /** The person approved paying here: the checkout's own requests may go, this run only. */
  purchaseAt(host: string): void {
    this.purchases.add(host);
  }

  async decide(url: URL, method: string): Promise<Decision> {
    const rules = await this.rules();
    const target = `${url.host}${url.pathname}`;
    const personal = personalDataIn(url);
    // Personal details may go only where she let Muse send.
    const trusted = rules.write.includes(url.host) || this.purchases.has(url.host);
    const decided: Omit<Decision, "method" | "target"> = rules.blocked.includes(url.host)
      ? { verdict: "block", reason: "you blocked this site" }
      : personal && !trusted
        ? { verdict: "block", reason: `it would send ${personal} to a site you haven't allowed` }
        : granted(rules, url.host, method)
          ? { verdict: "allow", reason: `you allowed ${grantFor(method) === "read" ? "reading" : "sending to"} this site` }
          : this.purchases.has(url.host)
            ? { verdict: "allow", reason: "you approved this purchase" }
            : READS.has(method) && this.read.has(url.host)
              ? { verdict: "allow", reason: "it already read this site in this errand" }
              : writesWithoutGrant(method, await judge(method, url, this.asked(), rules).catch(() => ({ verdict: "ask" as const, reason: "the Sentinel could not decide" })));
    const decision = { ...decided, method, target };
    if (decision.verdict === "allow" && READS.has(method)) this.read.add(url.host);
    this.decisions.set(url.host, decision);
    await logActivity({ person: this.ctx.workspaceId, kind: "sentinel", what: `${method} ${target}`, outcome: decision.verdict, detail: decision.reason });
    return decision;
  }

  /**
   * For glove-execution/kuiper: true lets the request out. A page loading,
   * and anything that could write (a form post, a page's own POST, a
   * WebSocket), gets a decision. A page's images, scripts and styles only
   * get the quick checks, so a page doesn't cost a decision per file.
   */
  readonly guard = async ({ url, method, resourceType, navigation }: KuiperBrowserRequest): Promise<boolean> => {
    const writes = !READS.has(method) || resourceType === "websocket";
    if (navigation || writes) return (await this.decide(url, resourceType === "websocket" ? "WEBSOCKET" : method)).verdict === "allow";
    return this.quickCheck(url, method);
  };

  /** A page's own files: a site she blocked, or personal details bound for a site she never allowed. */
  private async quickCheck(url: URL, method: string): Promise<boolean> {
    const rules = await this.rules();
    const personal = personalDataIn(url);
    const trusted = rules.write.includes(url.host) || this.purchases.has(url.host);
    if (!rules.blocked.includes(url.host) && !(personal && !trusted)) return true;
    await logActivity({ person: this.ctx.workspaceId, kind: "sentinel", what: `${method} ${url.host}${url.pathname}`, outcome: "block", detail: personal ? `it would send ${personal} to a site you haven't allowed` : "you blocked this site" });
    return false;
  }

  decisionFor(host: string): Decision | undefined {
    return this.decisions.get(host);
  }
}

// One Sentinel per run: the VM and request_access share what it decided.
const byRun = new Map<string, Sentinel>();

export function sentinelFor(ctx: Pick<AgentAssemblyContext, "runId" | "agentId" | "workspaceId" | "agentInstance" | "data" | "request" | "messageText">): Sentinel {
  let sentinel = byRun.get(ctx.runId);
  if (!sentinel) {
    sentinel = new Sentinel(ctx);
    byRun.set(ctx.runId, sentinel);
    if (byRun.size > 64) byRun.delete(byRun.keys().next().value!);
  }
  return sentinel;
}

const hostOf = (site: string) => {
  try {
    return new URL(site.includes("://") ? site : `https://${site}`).host;
  } catch {
    return site;
  }
};

/**
 * How the Sentinel asks the person. Muse calls it after a request was stopped.
 * It waits for the person only when the Sentinel said "ask"; their approval is
 * what adds the site. A blocked request stays blocked.
 */
export function requestAccessTool(ctx: Parameters<typeof sentinelFor>[0]) {
  const sentinel = sentinelFor(ctx);
  return {
    name: "request_access",
    description:
      "After your browser was stopped from loading a page or sending something, ask the Sentinel why, and if it wants the person's say, ask them. Give the site and what it is for.",
    inputSchema: z.object({
      site: z.string().min(1).describe("The site, like bistro-luna.example."),
      access: z.enum(["read", "write"]).describe("What the person would allow: reading the site, or sending to it. It must match what the Sentinel stopped."),
      why: z.string().min(1).describe("What you need it for, in the person's terms."),
    }),
    // The person is asked only when the Sentinel wants them to decide.
    requiresPermission: (input: { readonly site: string }) => sentinel.decisionFor(hostOf(input.site))?.verdict === "ask",
    async do(input: { readonly site: string; readonly access: "read" | "write"; readonly why: string }) {
      const host = hostOf(input.site);
      const decision = sentinel.decisionFor(host);
      if (!decision) {
        return { status: "error" as const, data: null, message: "Try it in the browser first; the Sentinel decides when it happens." };
      }
      if (decision.verdict === "block") {
        return { status: "error" as const, data: null, message: `The Sentinel blocked ${decision.method} ${decision.target}: ${decision.reason}. Don't look for another way. Tell the person if it matters.` };
      }
      if (decision.verdict === "allow") {
        return { status: "success" as const, data: { site: host, allowed: true, note: "Already allowed; the request failed for another reason." } };
      }
      // The person approved what the card showed, and only that: reading the site, or sending to it.
      const grant = grantFor(decision.method);
      if (grant !== input.access) {
        return { status: "error" as const, data: null, message: `The Sentinel stopped ${decision.method} ${decision.target}, which needs ${grant} access, not ${input.access}. Ask again with access "${grant}".` };
      }
      const current = await Effect.runPromise(ctx.data.getAgent(ctx.agentId));
      if (!current) return { status: "error" as const, data: null, message: "This Muse no longer exists." };
      const rules = rulesOf(current.context);
      await Effect.runPromise(ctx.data.putAgent({
        ...current,
        context: { ...current.context, sentinel: { ...rules, [grant]: [...new Set([...rules[grant], host])] } },
        updatedAt: new Date().toISOString(),
      }));
      sentinel.allowed(host, grant, rules);
      await logActivity({ person: ctx.workspaceId, kind: "sentinel", what: `allow ${grant === "read" ? "reading" : "sending to"} ${host}`, outcome: "the person allowed it", detail: input.why });
      return { status: "success" as const, data: { site: host, allowed: true, access: grant, note: grant === "read" ? "The person allowed reading it, not sending to it. Try the request again." : "The person allowed it. Try the request again." } };
    },
  };
}

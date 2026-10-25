import { Effect } from "effect";
import { choice, llmClassifier, type ClassifierAdapter } from "glove-classifier";
import { createAdapter } from "glove-core/models/providers";
import type { AgentAssemblyContext } from "glove-foundry";
import { z } from "zod";
import { logActivity } from "../../lib/activity.js";
import whatsapp from "./transmissions/whatsapp.transmission.js";

/**
 * The Sentinel. Nothing Muse's computer sends reaches the internet unless the
 * Sentinel lets it: env:fetch calls `authorize` for every request and every
 * redirect, outside the sandbox, before anything leaves.
 *
 * It is kept apart from Muse on purpose. It never sees Muse's conversation,
 * its reasoning or the pages it read, so a page that tells Muse what to do
 * cannot talk the Sentinel round. It sees the request, what the person asked
 * for in this run (their own words), and the sites they have allowed.
 *
 * Three answers: allow, block, or ask the person. When it asks, Muse puts the
 * question to them with request_access; only their approval adds a site to
 * the list Muse works within.
 */

export type Verdict = "allow" | "ask" | "block";

export interface SentinelRules {
  /** Sites the person allowed, by host. */
  readonly allowed: ReadonlyArray<string>;
  /** Sites the person never wants reached, by host. */
  readonly blocked: ReadonlyArray<string>;
}

export interface Decision {
  readonly verdict: Verdict;
  readonly reason: string;
  readonly method: string;
  /** Host and path only: a query string can carry data. */
  readonly target: string;
}

export function rulesOf(context: Readonly<Record<string, unknown>>): SentinelRules {
  const rules = context.sentinel as Partial<SentinelRules> | undefined;
  return { allowed: [...(rules?.allowed ?? [])], blocked: [...(rules?.blocked ?? [])] };
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

/**
 * The Sentinel's own model, separate from Muse's. With a key it is a small
 * model answering one typed question; without one, a fixed rule stands in:
 * reads pass, anything that writes asks.
 */
const model: ClassifierAdapter | undefined = process.env.ANTHROPIC_API_KEY && process.env.MUSE_DEMO !== "1"
  ? llmClassifier({
      model: createAdapter({
        provider: "anthropic",
        model: process.env.SENTINEL_MODEL ?? "claude-haiku-5-5",
        ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
      }),
    })
  : undefined;

async function judge(method: string, url: URL, asked: string | undefined, rules: SentinelRules): Promise<Omit<Decision, "method" | "target">> {
  if (!model) {
    return READS.has(method)
      ? { verdict: "allow", reason: "it only reads a public page" }
      : { verdict: "ask", reason: `it would ${method} to ${url.host}, which you haven't allowed` };
  }
  const { answers } = await model.classify({
    state: {
      request: `${method} ${url.origin}${url.pathname}`,
      the_person_asked: asked ?? "(nobody: Muse is working on its own)",
      sites_the_person_allowed: [...rules.allowed],
    },
    questions: {
      verdict: choice("Should this request leave the person's agent computer?", {
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

  constructor(private readonly ctx: Pick<AgentAssemblyContext, "agentId" | "workspaceId" | "agentInstance" | "data" | "request" | "messageText">) {}

  /** The person's words, when the person started this run. New mail and schedules are not them. */
  private asked(): string | undefined {
    const source = this.ctx.request.source;
    if (source?.kind === "direct") return this.ctx.messageText;
    if (source?.kind === "transmission" && source.provider === whatsapp.id) return this.ctx.messageText;
    return undefined;
  }

  /** The rules as they are now: the person may have allowed a site a moment ago. */
  private async rules(): Promise<SentinelRules> {
    const current = await Effect.runPromise(this.ctx.data.getAgent(this.ctx.agentId));
    return rulesOf(current?.context ?? this.ctx.agentInstance.context);
  }

  async decide(url: URL, method: string): Promise<Decision> {
    const rules = await this.rules();
    const target = `${url.host}${url.pathname}`;
    const personal = personalDataIn(url);
    const decided: Omit<Decision, "method" | "target"> = rules.blocked.includes(url.host)
      ? { verdict: "block", reason: "you blocked this site" }
      : personal && !rules.allowed.includes(url.host)
        ? { verdict: "block", reason: `it would send ${personal} to a site you haven't allowed` }
        : rules.allowed.includes(url.host)
          ? { verdict: "allow", reason: "you allowed this site" }
          : await judge(method, url, this.asked(), rules).catch(() => ({ verdict: "ask" as const, reason: "the Sentinel could not decide" }));
    const decision = { ...decided, method, target };
    this.decisions.set(url.host, decision);
    await logActivity({ person: this.ctx.workspaceId, kind: "sentinel", what: `${method} ${target}`, outcome: decision.verdict, detail: decision.reason });
    return decision;
  }

  /** For env:fetch: true lets the request out. */
  readonly authorize = async (url: URL, method: string): Promise<boolean> => (await this.decide(url, method)).verdict === "allow";

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
      "After a request from your computer was stopped, ask the Sentinel why, and if it wants the person's say, ask them. Give the site and what it is for.",
    inputSchema: z.object({
      site: z.string().min(1).describe("The site, like bistro-luna.example."),
      why: z.string().min(1).describe("What you need it for, in the person's terms."),
    }),
    // The person is asked only when the Sentinel wants them to decide.
    requiresPermission: (input: { readonly site: string }) => sentinel.decisionFor(hostOf(input.site))?.verdict === "ask",
    async do(input: { readonly site: string; readonly why: string }) {
      const host = hostOf(input.site);
      const decision = sentinel.decisionFor(host);
      if (!decision) {
        return { status: "error" as const, data: null, message: "Make the request first; the Sentinel decides when it happens." };
      }
      if (decision.verdict === "block") {
        return { status: "error" as const, data: null, message: `The Sentinel blocked ${decision.method} ${decision.target}: ${decision.reason}. Don't look for another way. Tell the person if it matters.` };
      }
      if (decision.verdict === "allow") {
        return { status: "success" as const, data: { site: host, allowed: true, note: "Already allowed; the request failed for another reason." } };
      }
      // The person approved: the site joins their list.
      const current = await Effect.runPromise(ctx.data.getAgent(ctx.agentId));
      if (!current) return { status: "error" as const, data: null, message: "This Muse no longer exists." };
      const rules = rulesOf(current.context);
      await Effect.runPromise(ctx.data.putAgent({
        ...current,
        context: { ...current.context, sentinel: { ...rules, allowed: [...new Set([...rules.allowed, host])] } },
        updatedAt: new Date().toISOString(),
      }));
      await logActivity({ person: ctx.workspaceId, kind: "sentinel", what: `allow ${host}`, outcome: "the person allowed it", detail: input.why });
      return { status: "success" as const, data: { site: host, allowed: true, note: "The person allowed it. Try the request again." } };
    },
  };
}

import { Effect } from "effect";
import { install, type AgentAssemblyContext, type AgentInstance } from "glove-foundry";
import { z } from "zod";
import slackApp from "../agents/dot/apps/slack.app.js";
import { slackBot } from "../agents/dot/topology.js";

/** How far a dot may go with an action, from its Custom Rules. */
export const LEVELS = ["act", "on-request", "ask", "hand-off"] as const;
export type Level = (typeof LEVELS)[number];

/** Where the dot talks with its person. Each is a conversation on the one instance. */
export const CHANNELS = {
  app: { key: "app", title: "App" },
  slack: { key: "slack", title: "Slack" },
} as const;
export type Channel = keyof typeof CHANNELS;

/** A dot: one responsibility it keeps between conversations, and the rules it acts by. */
export const Dot = z.object({
  name: z.string().min(1),
  /** The person it works for. */
  owner: z.string().min(1),
  responsibility: z.object({
    /** What should stay true or get done. */
    job: z.string().min(1),
    /** What it reads. */
    sources: z.array(z.string()).min(1),
    /** What deserves the person's attention. */
    attention: z.string(),
    /** What it must not do yet. */
    mustNot: z.string(),
  }),
  /** Action name → level. An action with no rule asks. */
  rules: z.record(z.string(), z.enum(LEVELS)),
  /** Routine progress and decisions can go to different channels. */
  routing: z.object({ progress: z.enum(["app", "slack"]), decisions: z.enum(["app", "slack"]) }),
  /** The owner's Slack user id, once they connect Slack. */
  slackUserId: z.string().optional(),
});
export type Dot = z.infer<typeof Dot>;

/**
 * What a dot instance is made of. Each person's dots and their builder share a
 * workspace, so they can reach each other on the mesh and nobody else can. The
 * Slack app is installed once the owner connects Slack.
 */
export function dotFor(ownerId: string, dot: Dot) {
  return {
    id: `${ownerId}-${dot.name}`,
    workspaceId: ownerId,
    name: dot.name,
    description: dot.responsibility.job,
    context: Dot.parse(dot),
    installations: dot.slackUserId ? [install(slackApp, undefined, { account: slackBot })] : [],
  };
}

/** The person's builder: one worker with a computer, for every dot they have. */
export function builderFor(ownerId: string) {
  return {
    id: `${ownerId}-builder`,
    workspaceId: ownerId,
    name: "Builder",
    description: "Builds reports and code on its own computer. Takes minutes. Give it the whole task.",
  };
}

type InstanceContext = Pick<AgentAssemblyContext, "agentId" | "agentInstance" | "data">;

/**
 * The instance as stored now. A recurring schedule fires with the instance as
 * it was when the schedule was armed, so resolvers read it fresh: changes to
 * the rules, the responsibility or Slack reach the next research run too.
 */
export async function storedInstance(ctx: InstanceContext): Promise<AgentInstance> {
  return (await Effect.runPromise(ctx.data.getAgent(ctx.agentId))) ?? ctx.agentInstance;
}

export async function currentDot(ctx: InstanceContext): Promise<Dot> {
  return Dot.parse((await storedInstance(ctx)).context);
}

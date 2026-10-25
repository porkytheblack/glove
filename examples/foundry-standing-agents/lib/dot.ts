import { Effect } from "effect";
import { install, type AccountReference, type AgentAssemblyContext, type AgentInstallation, type AgentInstance } from "glove-foundry";
import { z } from "zod";
import slackApp from "../agents/dot/apps/slack.app.js";
import { slackBot } from "../agents/dot/topology.js";

/**
 * Custom Rules: for each action, whether the dot may take it on its own, must
 * ask first, or must not take it at all (then it hands the action to you).
 * Built-in safety rules apply on top, whatever these say.
 */
export const LEVELS = ["allow", "ask", "block"] as const;
export type Level = (typeof LEVELS)[number];

/** Where the dot talks with its person. Each is a conversation on the one instance. */
export const CHANNELS = {
  app: { key: "app", title: "App" },
  slack: { key: "slack", title: "Slack" },
} as const;
export type Channel = keyof typeof CHANNELS;

/** Something the dot keeps working on between conversations. A dot can hold several. */
export const Responsibility = z.object({
  /** What should stay true or get done. */
  job: z.string().min(1),
  /** What it reads. */
  sources: z.array(z.string()).min(1),
  /** What deserves the person's attention. */
  attention: z.string(),
  /** What it must not do yet. */
  mustNot: z.string(),
});
export type Responsibility = z.infer<typeof Responsibility>;

/** A dot, as data: its name, who it works for, what it keeps working on, and its rules. */
export const Dot = z.object({
  /** The name its person gave it. */
  name: z.string().min(1),
  /** The person it works for, or the team a specialist dot serves. */
  owner: z.string().min(1),
  /** A person's own dot, or a specialist an organisation sets up with its own identity. */
  kind: z.enum(["primary", "specialist"]).default("primary"),
  responsibilities: z.array(Responsibility).min(1),
  /** Action name → Custom Rule. An action with no rule asks. */
  rules: z.record(z.string(), z.enum(LEVELS)),
  /** Routine progress and decisions can go to different channels. */
  routing: z.object({ progress: z.enum(["app", "slack"]), decisions: z.enum(["app", "slack"]) }),
  /** The owner's Slack user id, once they connect Slack. */
  slackUserId: z.string().optional(),
});
/** A dot as you write it; `kind` defaults to "primary". */
export type Dot = z.input<typeof Dot>;
/** A dot as stored and read back. */
export type ParsedDot = z.output<typeof Dot>;

/**
 * A person's primary dot. They name it and make it their own; everything that
 * makes it theirs is this data. The person's dot and their builder share a
 * workspace, so they reach each other on the mesh and nobody else can. The
 * Slack app is installed once the owner connects Slack; their Gmail, once
 * they connect it (lib/connect.ts), or here for a seed.
 */
export function primaryDot(ownerId: string, dot: Dot, installations: ReadonlyArray<AgentInstallation> = []) {
  const parsed = Dot.parse({ ...dot, kind: "primary" });
  return {
    id: `${ownerId}-dot`,
    workspaceId: ownerId,
    name: parsed.name,
    description: `${parsed.owner}'s dot`,
    context: parsed,
    installations: [...(parsed.slackUserId ? [install(slackApp, undefined, { account: slackBot })] : []), ...installations],
  };
}

/**
 * A specialist dot: the same definition, set up by an organisation in its own
 * workspace for one well-defined job, with its own name and, when given, its
 * own account, so it acts under its own credentials rather than a person's.
 * Its own mailbox connects the same way a person's does (lib/connect.ts).
 */
export function specialistFor(org: string, specialist: Omit<Dot, "kind"> & { readonly account?: AccountReference }) {
  const { account, ...dot } = specialist;
  const parsed = Dot.parse({ ...dot, kind: "specialist" });
  return {
    id: `${org}-${parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    workspaceId: org,
    name: parsed.name,
    description: `Specialist dot for ${parsed.owner}: ${parsed.responsibilities.map((item) => item.job).join(" ")}`,
    context: parsed,
    installations: [install(slackApp, undefined, { account: account ?? slackBot })],
  };
}

/** The person's builder: a worker with a computer that their dot starts coding jobs on. */
export function builderFor(ownerId: string) {
  return {
    id: `${ownerId}-builder`,
    workspaceId: ownerId,
    name: "Builder",
    description: "Builds reports and code on its own computer. Takes minutes. Give it the whole task.",
  };
}

/** Sam, the person the example is seeded with. His dot is called Pip. */
export const SAM = {
  id: "sam",
  dot: {
    name: "Pip",
    owner: "Sam",
    responsibilities: [
      {
        job: "Track product feedback from #feedback and the support inbox, and group the reports.",
        sources: ["#feedback", "support inbox"],
        attention: "A problem several people report, or anything that blocks a customer.",
        mustNot: "Reply to anyone without Sam's approval.",
      },
      {
        job: "Make sure every customer who wrote to support hears back within a day.",
        sources: ["support inbox"],
        attention: "Anyone who has waited more than a day.",
        mustNot: "Promise a ship date.",
      },
    ],
    rules: { send_email: "ask", open_draft_pr: "allow", merge_pr: "block" },
    routing: { progress: "app", decisions: "slack" },
    slackUserId: "U0SAM",
  } satisfies Dot,
} as const;

type InstanceContext = Pick<AgentAssemblyContext, "agentId" | "agentInstance" | "data">;

/**
 * The instance as stored now. A recurring schedule fires with the instance as
 * it was when the schedule was armed, so resolvers read it fresh: changes to
 * the rules, the responsibilities or Slack reach the next research run too.
 */
export async function storedInstance(ctx: InstanceContext): Promise<AgentInstance> {
  return (await Effect.runPromise(ctx.data.getAgent(ctx.agentId))) ?? ctx.agentInstance;
}

export async function currentDot(ctx: InstanceContext): Promise<ParsedDot> {
  return Dot.parse((await storedInstance(ctx)).context);
}

import { randomUUID } from "node:crypto";
import { createFoundryClient } from "glove-foundry/client";
import { z } from "zod";
import { CAMPAIGN_AGENT_ID, CAMPAIGN_CONVERSATION_ID } from "./protocol";
import { normalizeStormId } from "./storm-id";

export const campaignExecutionSchema = z.enum(["auto", "parallel", "sequential"]);

export const campaignSchema = z.object({
  id: z.string().min(1).max(80).optional().describe("A short stable campaign id used by dependsOn."),
  name: z.string().min(2).max(120).describe("A human-readable campaign name."),
  brief: z.string().min(10).max(12_000).describe("The complete campaign problem, audience, constraints, and desired outcome."),
  dependsOn: z.array(z.string().min(1).max(80)).max(8).default([]).describe("Campaign ids that must finish before this campaign starts."),
});

export const campaignBatchSchema = z.object({
  batchId: z.string().min(1).max(100).optional(),
  parentStormId: z.string().min(1).max(120),
  campaigns: z.array(campaignSchema).min(1).max(8),
  execution: campaignExecutionSchema.default("auto"),
  skillPacks: z.array(z.string().min(1).max(100)).min(1).max(8).default(["marketing"]),
  generateImage: z.boolean().default(true),
  remoteSkills: z.boolean().default(true),
});

export type CampaignExecution = z.infer<typeof campaignExecutionSchema>;
export type CampaignBatchInput = z.infer<typeof campaignBatchSchema>;

export interface NormalizedCampaign {
  readonly id: string;
  readonly name: string;
  readonly brief: string;
  readonly dependsOn: ReadonlyArray<string>;
}

export interface NormalizedCampaignBatch extends Omit<CampaignBatchInput, "batchId" | "parentStormId" | "campaigns"> {
  readonly batchId: string;
  readonly parentStormId: string;
  readonly campaigns: ReadonlyArray<NormalizedCampaign>;
}

export type ResolvedCampaignExecution = "parallel" | "sequential" | "dependency-waves";
export type CampaignItemStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export interface CampaignItemResult {
  readonly campaignId: string;
  readonly name: string;
  readonly stormId: string;
  readonly status: CampaignItemStatus;
  readonly runId?: string;
  readonly error?: string;
  readonly artifactCount?: number;
}

export interface CampaignBatchResult {
  readonly batchId: string;
  readonly parentStormId: string;
  readonly requestedExecution: CampaignExecution;
  readonly resolvedExecution: ResolvedCampaignExecution;
  readonly waves: ReadonlyArray<ReadonlyArray<string>>;
  readonly items: ReadonlyArray<CampaignItemResult>;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface CampaignLaunchReceipt {
  readonly accepted: true;
  readonly batchId: string;
  readonly batchRunId: string;
  readonly campaignCount: number;
  readonly execution: CampaignExecution;
  readonly message: string;
}

export interface CampaignLaunchAdapter {
  readonly launch: (input: CampaignBatchInput) => Promise<CampaignLaunchReceipt>;
}

function campaignId(value: string): string {
  return normalizeStormId(value).slice(0, 64);
}

export function normalizeCampaignBatch(value: unknown): NormalizedCampaignBatch {
  const parsed = campaignBatchSchema.parse(value);
  const campaigns = parsed.campaigns.map((campaign) => ({
    ...campaign,
    id: campaignId(campaign.id ?? campaign.name),
    dependsOn: campaign.dependsOn.map(campaignId),
  }));
  const ids = campaigns.map((campaign) => campaign.id);
  if (new Set(ids).size !== ids.length) throw new Error("Campaign ids must be unique after normalization.");
  for (const campaign of campaigns) {
    for (const dependency of campaign.dependsOn) {
      if (!ids.includes(dependency)) throw new Error(`Campaign "${campaign.id}" depends on unknown campaign "${dependency}".`);
      if (dependency === campaign.id) throw new Error(`Campaign "${campaign.id}" cannot depend on itself.`);
    }
  }
  return {
    ...parsed,
    batchId: parsed.batchId ? campaignId(parsed.batchId) : `batch-${randomUUID()}`,
    parentStormId: normalizeStormId(parsed.parentStormId),
    campaigns,
  };
}

export function planCampaignWaves(input: NormalizedCampaignBatch): {
  readonly resolvedExecution: ResolvedCampaignExecution;
  readonly waves: ReadonlyArray<ReadonlyArray<NormalizedCampaign>>;
} {
  if (input.execution === "parallel") return { resolvedExecution: "parallel", waves: [input.campaigns] };
  if (input.execution === "sequential") return { resolvedExecution: "sequential", waves: input.campaigns.map((campaign) => [campaign]) };
  if (input.campaigns.every((campaign) => campaign.dependsOn.length === 0)) {
    return { resolvedExecution: "parallel", waves: [input.campaigns] };
  }

  const remaining = new Map(input.campaigns.map((campaign) => [campaign.id, campaign]));
  const completed = new Set<string>();
  const waves: NormalizedCampaign[][] = [];
  while (remaining.size > 0) {
    const wave = [...remaining.values()].filter((campaign) => campaign.dependsOn.every((id) => completed.has(id)));
    if (wave.length === 0) throw new Error("Campaign dependencies contain a cycle.");
    waves.push(wave);
    for (const campaign of wave) {
      remaining.delete(campaign.id);
      completed.add(campaign.id);
    }
  }
  return { resolvedExecution: "dependency-waves", waves };
}

export function foundryCampaignLaunchAdapter(options: {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
} = {}): CampaignLaunchAdapter {
  const client = createFoundryClient({
    baseUrl: options.baseUrl ?? process.env.FOUNDRY_URL ?? "http://127.0.0.1:4260",
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    async launch(value) {
      const input = normalizeCampaignBatch(value);
      const handle = await client.send(
        CAMPAIGN_AGENT_ID,
        CAMPAIGN_CONVERSATION_ID,
        `Coordinate ${input.campaigns.length} campaign${input.campaigns.length === 1 ? "" : "s"} for ${input.parentStormId}.`,
        { payload: input },
      );
      return {
        accepted: true,
        batchId: input.batchId,
        batchRunId: handle.id,
        campaignCount: input.campaigns.length,
        execution: input.execution,
        message: input.execution === "sequential"
          ? "The workforce will complete each campaign in order."
          : input.execution === "parallel"
            ? "All campaign workforces have been queued together."
            : "Foundry will run independent campaigns together and hold dependent campaigns for a later wave.",
      };
    },
  };
}

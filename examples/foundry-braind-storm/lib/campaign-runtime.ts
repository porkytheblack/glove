import { createFoundryClient } from "glove-foundry/client";
import type { AgentHandlerContext } from "glove-foundry";
import { Effect } from "effect";
import {
  type CampaignBatchResult,
  type CampaignItemResult,
  type NormalizedCampaign,
  type NormalizedCampaignBatch,
  planCampaignWaves,
} from "./campaigns.js";
import { LEAD_AGENT_ID } from "./protocol.js";
import { normalizeStormId } from "./storm-id.js";

interface FoundryCustomOutput<T> {
  readonly kind?: string;
  readonly value?: T;
}

interface StormOutput {
  readonly artifacts?: ReadonlyArray<unknown>;
}

function itemConversationId(batchId: string, campaignId: string): string {
  return `braind-campaign-${normalizeStormId(batchId)}-${normalizeStormId(campaignId)}`.slice(0, 190);
}

function itemStormId(input: NormalizedCampaignBatch, campaign: NormalizedCampaign): string {
  return normalizeStormId(`${input.parentStormId}-${campaign.id}`);
}

export function executeCampaignBatch(
  input: NormalizedCampaignBatch,
  context: AgentHandlerContext,
): Effect.Effect<CampaignBatchResult, never, never> {
  const client = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4260" });
  const startedAt = new Date().toISOString();
  const plan = planCampaignWaves(input);
  const results = new Map<string, CampaignItemResult>();

  const emit = (type: string, data: unknown): void => context.emit({ type, data });
  emit("braind.campaign.batch.started", {
    batchId: input.batchId,
    parentStormId: input.parentStormId,
    requestedExecution: input.execution,
    resolvedExecution: plan.resolvedExecution,
    waves: plan.waves.map((wave) => wave.map((campaign) => campaign.id)),
    campaigns: input.campaigns.map(({ id, name, dependsOn }) => ({ id, name, dependsOn })),
  });
  for (const campaign of input.campaigns) {
    const queued: CampaignItemResult = {
      campaignId: campaign.id,
      name: campaign.name,
      stormId: itemStormId(input, campaign),
      status: "queued",
    };
    results.set(campaign.id, queued);
    emit("braind.campaign.item.queued", { batchId: input.batchId, ...queued });
  }

  const runCampaign = (campaign: NormalizedCampaign): Effect.Effect<CampaignItemResult, never, never> => Effect.tryPromise({
    try: async () => {
      const blockedBy = campaign.dependsOn.find((id) => {
        const dependency = results.get(id);
        return dependency && dependency.status !== "completed";
      });
      if (blockedBy) {
        const skipped: CampaignItemResult = {
          campaignId: campaign.id,
          name: campaign.name,
          stormId: itemStormId(input, campaign),
          status: "skipped",
          error: `Dependency "${blockedBy}" did not complete.`,
        };
        results.set(campaign.id, skipped);
        emit("braind.campaign.item.skipped", { batchId: input.batchId, ...skipped });
        return skipped;
      }

      const conversationId = itemConversationId(input.batchId, campaign.id);
      const existing = await client.conversations(LEAD_AGENT_ID);
      if (!existing.some((conversation) => conversation.id === conversationId)) {
        await client.createConversation(LEAD_AGENT_ID, {
          id: conversationId,
          workspaceId: context.workspaceId,
          title: campaign.name,
          context: {
            channel: "campaign-orchestrator",
            batchId: input.batchId,
            campaignId: campaign.id,
            parentRunId: context.runId,
          },
        });
      }
      const handle = await client.send(LEAD_AGENT_ID, conversationId, campaign.brief, {
        payload: {
          stormId: itemStormId(input, campaign),
          skillPacks: input.skillPacks,
          generateImage: input.generateImage,
          remoteSkills: input.remoteSkills,
          transcript: [{ role: "user", text: `Campaign batch ${input.batchId}: ${campaign.name}` }],
        },
        context: {
          batchId: input.batchId,
          parentStormId: input.parentStormId,
          campaignId: campaign.id,
          parentRunId: context.runId,
        },
      });
      const running: CampaignItemResult = {
        campaignId: campaign.id,
        name: campaign.name,
        stormId: itemStormId(input, campaign),
        status: "running",
        runId: handle.id,
      };
      results.set(campaign.id, running);
      emit("braind.campaign.item.started", { batchId: input.batchId, ...running });
      const run = await handle.wait({ pollMs: 750, timeoutMs: 20 * 60_000 });
      if (run.status !== "completed") throw new Error(run.error ?? `Campaign run ${run.status}.`);
      const output = run.output as FoundryCustomOutput<StormOutput> | undefined;
      const completed: CampaignItemResult = {
        ...running,
        status: "completed",
        artifactCount: output?.value?.artifacts?.length ?? 0,
      };
      results.set(campaign.id, completed);
      emit("braind.campaign.item.completed", { batchId: input.batchId, ...completed });
      return completed;
    },
    catch: (cause) => cause,
  }).pipe(
    Effect.catchAll((cause) => {
      const previous = results.get(campaign.id);
      const failed: CampaignItemResult = {
        campaignId: campaign.id,
        name: campaign.name,
        stormId: itemStormId(input, campaign),
        status: "failed",
        ...(previous?.runId ? { runId: previous.runId } : {}),
        error: cause instanceof Error ? cause.message : String(cause),
      };
      results.set(campaign.id, failed);
      emit("braind.campaign.item.failed", { batchId: input.batchId, ...failed });
      return Effect.succeed(failed);
    }),
  );

  return Effect.gen(function* () {
    for (const [index, wave] of plan.waves.entries()) {
      emit("braind.campaign.wave.started", {
        batchId: input.batchId,
        wave: index + 1,
        campaigns: wave.map((campaign) => campaign.id),
      });
      yield* Effect.forEach(wave, runCampaign, { concurrency: "unbounded" });
      emit("braind.campaign.wave.completed", {
        batchId: input.batchId,
        wave: index + 1,
        campaigns: wave.map((campaign) => campaign.id),
      });
    }
    const result: CampaignBatchResult = {
      batchId: input.batchId,
      parentStormId: input.parentStormId,
      requestedExecution: input.execution,
      resolvedExecution: plan.resolvedExecution,
      waves: plan.waves.map((wave) => wave.map((campaign) => campaign.id)),
      items: input.campaigns.map((campaign) => results.get(campaign.id)!),
      startedAt,
      completedAt: new Date().toISOString(),
    };
    emit("braind.campaign.batch.completed", result);
    return result;
  });
}

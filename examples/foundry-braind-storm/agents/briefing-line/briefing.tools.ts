import type { GloveFoldArgs } from "glove-core";
import { z } from "zod";
import {
  campaignExecutionSchema,
  campaignSchema,
  foundryCampaignLaunchAdapter,
  type CampaignLaunchAdapter,
} from "../../lib/campaigns.js";
import { readBriefingSnapshot, recordVoiceDirection } from "./briefing-workspace.js";

export function briefingTools(
  stormId: string,
  campaignLauncher: CampaignLaunchAdapter = foundryCampaignLaunchAdapter(),
): ReadonlyArray<GloveFoldArgs<any>> {
  return [
    {
      name: "get_storm_briefing",
      description: "Read the latest lead recommendation, strategy, creative direction, critique, artifact list, and recorded caller direction for this storm.",
      inputSchema: z.object({
        detail: z.enum(["headline", "full"]).default("headline").describe("Use headline for a concise phone briefing and full when the caller asks for detail."),
      }),
      async do({ detail }) {
        return { status: "success" as const, data: await readBriefingSnapshot(stormId, detail) };
      },
    },
    {
      name: "record_direction",
      description: "Durably record an instruction, correction, decision, or idea from the caller so the Braind Storm workforce receives it on its next run.",
      inputSchema: z.object({
        direction: z.string().min(3).max(4_000).describe("The caller's direction, preserving concrete wording and constraints."),
        priority: z.enum(["note", "important", "urgent"]).default("important").describe("How strongly the team should weight this direction."),
        appliesTo: z.string().min(1).max(120).default("the whole brand system").describe("The workstream or artifact this direction should change."),
      }),
      async do(input) {
        return { status: "success" as const, data: await recordVoiceDirection({ stormId, ...input }) };
      },
    },
    {
      name: "launch_campaign_workforce",
      description: "Launch one or more complete Braind Storm workforces from the call. Use parallel for independent campaigns, sequential when order matters, or auto to run dependency-aware waves. Returns immediately with a durable Foundry batch run id.",
      unAbortable: true,
      inputSchema: z.object({
        campaigns: z.array(campaignSchema).min(1).max(8).describe("Every distinct campaign the caller asked the workforce to complete."),
        execution: campaignExecutionSchema.default("auto").describe("Choose parallel for independent campaigns, sequential for strict input order, or auto when dependsOn should determine waves."),
        skillPacks: z.array(z.string().min(1).max(100)).min(1).max(8).default(["marketing"]),
        generateImage: z.boolean().default(true).describe("Whether each campaign workforce should generate and review visual key art."),
      }),
      async do(input) {
        try {
          return {
            status: "success" as const,
            data: await campaignLauncher.launch({
              parentStormId: stormId,
              campaigns: input.campaigns,
              execution: input.execution,
              skillPacks: input.skillPacks,
              generateImage: input.generateImage,
              remoteSkills: true,
            }),
          };
        } catch (cause) {
          return {
            status: "error" as const,
            data: null,
            message: cause instanceof Error ? cause.message : String(cause),
          };
        }
      },
    },
  ];
}

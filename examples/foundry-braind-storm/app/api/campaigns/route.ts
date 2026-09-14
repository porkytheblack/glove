import { NextResponse } from "next/server";
import { createFoundryClient } from "glove-foundry/client";
import {
  foundryCampaignLaunchAdapter,
  campaignBatchSchema,
  type CampaignItemResult,
} from "../../../lib/campaigns";

const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4260" });
const launcher = foundryCampaignLaunchAdapter();

interface CampaignBatchStarted {
  readonly batchId: string;
  readonly parentStormId: string;
  readonly requestedExecution: string;
  readonly resolvedExecution: string;
  readonly waves: ReadonlyArray<ReadonlyArray<string>>;
  readonly campaigns: ReadonlyArray<{ readonly id: string; readonly name: string; readonly dependsOn: ReadonlyArray<string> }>;
}

function suffix(type: string): string {
  return type.split(".").slice(-4).join(".");
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const input = campaignBatchSchema.parse(await request.json());
    const receipt = await launcher.launch(input);
    return NextResponse.json(receipt, { status: 202 });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const parentStormId = new URL(request.url).searchParams.get("parentStormId");
    const runs = [...await foundry.runs("campaign-orchestrator")]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 24);
    const batches = (await Promise.all(runs.map(async (run) => {
      const events = await foundry.getEvents({ runId: run.id });
      const startedEvent = events.find((event) => event.type.endsWith("braind.campaign.batch.started"));
      const started = startedEvent?.data as CampaignBatchStarted | undefined;
      if (!started?.batchId || !started.parentStormId) return null;
      const items = new Map<string, CampaignItemResult>();
      for (const event of events) {
        if (!event.type.includes("braind.campaign.item.")) continue;
        const item = event.data as CampaignItemResult & { readonly batchId?: string };
        if (item.campaignId) items.set(item.campaignId, item);
      }
      return {
        runId: run.id,
        status: run.status,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        ...started,
        items: started.campaigns.map((campaign) => items.get(campaign.id) ?? {
          campaignId: campaign.id,
          name: campaign.name,
          stormId: "",
          status: "queued" as const,
        }),
        eventCount: events.length,
        lastEvent: events.at(-1) ? suffix(events.at(-1)!.type) : undefined,
      };
    }))).filter((batch): batch is NonNullable<typeof batch> => Boolean(batch));
    return NextResponse.json({
      batches: parentStormId ? batches.filter((batch) => batch.parentStormId === parentStormId) : batches,
    });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
  }
}

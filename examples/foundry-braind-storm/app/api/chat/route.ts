import { NextResponse } from "next/server";
import { createFoundryClient } from "glove-foundry/client";
import { LEAD_AGENT_ID, LEAD_CONVERSATION_ID } from "../../../lib/protocol";

const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4260" });

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      message?: string;
      stormId?: string;
      skillPacks?: string[];
      generateImage?: boolean;
      transcript?: Array<{ role: "user" | "assistant"; text: string }>;
    };
    if (!body.message?.trim()) return NextResponse.json({ error: "A brief or question is required." }, { status: 400 });
    const handle = await foundry.send(LEAD_AGENT_ID, LEAD_CONVERSATION_ID, body.message.trim(), {
      payload: {
        stormId: body.stormId ?? `storm-${Date.now()}`,
        skillPacks: body.skillPacks?.length ? body.skillPacks : ["marketing"],
        generateImage: body.generateImage ?? true,
        remoteSkills: true,
        transcript: body.transcript?.slice(-8),
      },
    });
    return NextResponse.json({ runId: handle.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId is required." }, { status: 400 });
  try {
    const [run, events] = await Promise.all([foundry.getRun(runId), foundry.getEvents({ runId })]);
    return NextResponse.json({
      run,
      events: events.filter((event) => event.type.includes("braind.") || event.type.startsWith("run.")),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}

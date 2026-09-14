import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { NextResponse } from "next/server";
import { createFoundryClient } from "glove-foundry/client";
import { racerById } from "../../../lib/racers";

const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4250" });
const basePort = Number(process.env.RACER_ROOM_BASE_PORT ?? 4700);
const slots = Number(process.env.RACER_ROOM_SLOTS ?? 8);
const roomHost = process.env.NEXT_PUBLIC_ROOM_HOST ?? "127.0.0.1";
const claimed = new Set<number>();
const runPorts = new Map<string, number>();

async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

async function claimPort(): Promise<number | null> {
  for (let offset = 1; offset <= slots; offset++) {
    const port = basePort + offset;
    if (claimed.has(port) || !(await portIsFree(port))) continue;
    claimed.add(port);
    return port;
  }
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  let port: number | null = null;
  try {
    const body = (await request.json()) as { racerId?: string; diagnostic?: boolean };
    const racer = racerById(body.racerId ?? "");
    port = await claimPort();
    if (port === null) {
      return NextResponse.json({ error: `All ${slots} live-call rooms are in use.` }, { status: 503 });
    }
    const token = randomBytes(24).toString("base64url");
    const handle = await foundry.send(
      racer.agentId,
      racer.conversationId,
      body.diagnostic
        ? `Start a diagnostic live paddock call with ${racer.name}.`
        : `Start a live paddock call with ${racer.name}.`,
      { payload: { port, token, idleMs: 90_000 } },
    );
    runPorts.set(handle.id, port);
    return NextResponse.json({
      runId: handle.id,
      port,
      wsUrl: `ws://${roomHost}:${port}/call?token=${encodeURIComponent(token)}`,
    });
  } catch (error) {
    if (port !== null) claimed.delete(port);
    return NextResponse.json(
      { error: `Could not start the Foundry call: ${error instanceof Error ? error.message : String(error)}` },
      { status: 503 },
    );
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");
  const port = Number(url.searchParams.get("port"));
  if (!runId || !Number.isInteger(port)) {
    return NextResponse.json({ error: "runId and port are required" }, { status: 400 });
  }
  try {
    const run = await foundry.getRun(runId);
    if (["failed", "cancelled", "completed"].includes(run.status)) {
      claimed.delete(port);
      runPorts.delete(runId);
      return NextResponse.json({ ready: false, dead: true, error: run.error ?? `Call ${run.status}.` });
    }
    const health = await fetch(`http://127.0.0.1:${port}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(700),
    }).catch(() => null);
    return NextResponse.json({ ready: Boolean(health?.ok), dead: false });
  } catch (error) {
    return NextResponse.json({
      ready: false,
      dead: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });
  try {
    const stopped = await foundry.cancelRun(runId);
    const port = runPorts.get(runId);
    if (port !== undefined) claimed.delete(port);
    runPorts.delete(runId);
    return NextResponse.json({ stopped });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}

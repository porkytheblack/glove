import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const foundryUrl = (process.env.FOUNDRY_URL ?? "http://127.0.0.1:4260").replace(/\/$/, "");

export async function GET(request: Request): Promise<Response> {
  const source = new URL(request.url);
  const runId = source.searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId is required." }, { status: 400 });

  const upstreamUrl = new URL(`${foundryUrl}/api/events`);
  upstreamUrl.searchParams.set("runId", runId);
  const after = source.searchParams.get("after");
  if (after) upstreamUrl.searchParams.set("after", after);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { accept: "text/event-stream" },
      cache: "no-store",
      signal: request.signal,
    });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: detail || `Foundry event stream failed (${upstream.status}).` },
        { status: 502 },
      );
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}

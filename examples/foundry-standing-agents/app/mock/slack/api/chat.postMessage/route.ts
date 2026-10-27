import { bearer, demoConnectors, mockLog } from "glove-foundry-web-kit/server";
import { host } from "../../../../server/host";

// The mock Slack's Web API: what the dot's posts reach when DEMO_CONNECTORS=1
// points SLACK_API_URL here. The same request and answer as Slack's
// chat.postMessage, including Slack's habit of answering 200 with ok: false.

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!demoConnectors()) return new Response(null, { status: 404 });
  if (!bearer(request, process.env.SLACK_BOT_TOKEN)) return Response.json({ ok: false, error: "invalid_auth" });
  const post = await request.json().catch(() => undefined) as { readonly channel?: unknown; readonly text?: unknown; readonly thread_ts?: unknown } | undefined;
  if (typeof post?.channel !== "string" || !post.channel) return Response.json({ ok: false, error: "channel_not_found" });
  if (typeof post.text !== "string" || !post.text) return Response.json({ ok: false, error: "no_text" });
  const now = Date.now();
  const ts = `${Math.floor(now / 1000)}.${String(now % 1000).padStart(6, "0")}`;
  await mockLog((await host()).dataDir).append({
    connector: "slack",
    direction: "out",
    channel: post.channel,
    text: post.text,
    ...(typeof post.thread_ts === "string" ? { thread_ts: post.thread_ts } : {}),
    ts,
    path: new URL(request.url).pathname,
  });
  return Response.json({ ok: true, channel: post.channel, ts, message: { type: "message", text: post.text, ts } });
}

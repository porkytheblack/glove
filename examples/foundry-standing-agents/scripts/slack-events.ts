import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

// Receives Slack's Events API and forwards DMs and mentions of the bot to
// Foundry's slack-messages route. Slack needs two things Foundry does not do
// itself: an answer to its url_verification challenge, and a signature check
// on every delivery.
//   SLACK_SIGNING_SECRET=… FOUNDRY_URL=http://127.0.0.1:4145 pnpm slack-events

const secret = process.env.SLACK_SIGNING_SECRET ?? "";
const foundryUrl = process.env.FOUNDRY_URL ?? "http://127.0.0.1:4145";
const port = Number(process.env.PORT ?? 4146);
if (!secret) throw new Error("Set SLACK_SIGNING_SECRET to the Slack app's signing secret.");

const FIVE_MINUTES = 5 * 60;

/** Slack signs `v0:<timestamp>:<body>` with the signing secret; old timestamps are replays. */
function signed(body: string, timestamp: string, signature: string): boolean {
  const sent = Number(timestamp);
  if (!Number.isFinite(sent) || Math.abs(Date.now() / 1000 - sent) > FIVE_MINUTES) return false;
  const expected = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface SlackEvent {
  readonly type: string;
  readonly channel_type?: string;
  readonly subtype?: string;
  readonly bot_id?: string;
  readonly user?: string;
  readonly channel: string;
  readonly ts: string;
  readonly thread_ts?: string;
}

interface SlackPayload {
  readonly type: string;
  readonly challenge?: string;
  readonly event_id?: string;
  readonly event?: SlackEvent;
}

/** DMs to the bot and mentions of it, from people. Edits, joins and the bot's own posts are skipped. */
function forwardable(event: SlackEvent | undefined): event is SlackEvent {
  if (!event?.user || event.bot_id || event.subtype) return false;
  return event.type === "app_mention" || (event.type === "message" && event.channel_type === "im");
}

async function forward(payload: SlackPayload & { event: SlackEvent }): Promise<void> {
  const response = await fetch(`${foundryUrl}/api/transmissions/slack-messages/fire`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.FOUNDRY_TOKEN ? { authorization: `Bearer ${process.env.FOUNDRY_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      // Slack retries a delivery it isn't sure of; the same event id is only handled once.
      eventId: payload.event_id ?? `${payload.event.channel}:${payload.event.ts}`,
      threadKey: payload.event.thread_ts ?? payload.event.channel,
      // Every Slack message from the owner joins the dot's one Slack conversation.
      conversationKey: "slack",
      conversationScope: "agent",
      raw: payload,
    }),
  });
  if (!response.ok) console.error(`Foundry refused ${payload.event_id}: ${response.status} ${await response.text()}`);
}

createServer(async (request, response) => {
  if (request.method !== "POST") return void response.writeHead(405).end();
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");
  const timestamp = String(request.headers["x-slack-request-timestamp"] ?? "");
  const signature = String(request.headers["x-slack-signature"] ?? "");
  if (!signed(body, timestamp, signature)) return void response.writeHead(401).end();

  const payload = JSON.parse(body) as SlackPayload;
  if (payload.type === "url_verification") {
    response.writeHead(200, { "content-type": "text/plain" });
    return void response.end(payload.challenge ?? "");
  }
  // Slack wants an answer within three seconds; forward after answering.
  response.writeHead(200).end();
  if (payload.type === "event_callback" && forwardable(payload.event)) {
    await forward(payload as SlackPayload & { event: SlackEvent }).catch((cause) => console.error(cause));
  }
}).listen(port, () => console.log(`Slack events on :${port}, forwarding to ${foundryUrl}`));

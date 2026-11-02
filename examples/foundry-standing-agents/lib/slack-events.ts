import { createHmac, timingSafeEqual } from "node:crypto";

// Slack's Events API, forwarded to Foundry's slack-messages route. Slack needs
// two things Foundry does not do itself: an answer to its url_verification
// challenge, and a signature check on every delivery. The web app serves this
// at /webhooks/slack, in the same unit as Foundry; the standalone
// scripts/slack-events.ts does the same for local runs.

export interface SlackEventsConfig {
  readonly signingSecret: string;
  readonly foundryUrl: string;
  readonly foundryToken?: string;
}

export function slackConfig(): SlackEventsConfig | undefined {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return undefined;
  return {
    signingSecret,
    foundryUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4145",
    ...(process.env.FOUNDRY_TOKEN ? { foundryToken: process.env.FOUNDRY_TOKEN } : {}),
  };
}

const FIVE_MINUTES = 5 * 60;

/** Slack signs `v0:<timestamp>:<body>` with the signing secret; old timestamps are replays. */
export function signed(body: string, timestamp: string, signature: string, signingSecret: string): boolean {
  const sent = Number(timestamp);
  if (!Number.isFinite(sent) || Math.abs(Date.now() / 1000 - sent) > FIVE_MINUTES) return false;
  const expected = Buffer.from(`v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface SlackEvent {
  readonly type: string;
  readonly channel_type?: string;
  readonly subtype?: string;
  readonly bot_id?: string;
  readonly user?: string;
  readonly channel: string;
  readonly ts: string;
  readonly thread_ts?: string;
}

export interface SlackPayload {
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

/** What Foundry answered for one event: its status, and the runs it started. */
export interface Forwarded {
  readonly event: SlackEvent;
  readonly status: number;
  readonly runIds: ReadonlyArray<string>;
}

async function forward(config: SlackEventsConfig, payload: SlackPayload, event: SlackEvent): Promise<Forwarded> {
  const response = await fetch(`${config.foundryUrl}/api/transmissions/slack-messages/fire`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.foundryToken ? { authorization: `Bearer ${config.foundryToken}` } : {}),
    },
    body: JSON.stringify({
      // Slack retries a delivery it isn't sure of; the same event id is only handled once.
      eventId: payload.event_id ?? `${event.channel}:${event.ts}`,
      threadKey: event.thread_ts ?? event.channel,
      // Every Slack message from the owner joins the dot's one Slack conversation.
      conversationKey: "slack",
      conversationScope: "agent",
      raw: payload,
    }),
  });
  const text = await response.text();
  if (!response.ok) console.error(`Foundry refused ${payload.event_id}: ${response.status} ${text}`);
  const runs = response.ok ? (JSON.parse(text) as ReadonlyArray<{ readonly id: string }>) : [];
  return { event, status: response.status, runIds: runs.map((run) => run.id) };
}

/** Forward a signed delivery if it is a DM or a mention; what Foundry answered, if it was. */
export async function forwardPayload(config: SlackEventsConfig, payload: SlackPayload): Promise<Forwarded | undefined> {
  if (payload.type !== "event_callback" || !forwardable(payload.event)) return undefined;
  const event = payload.event;
  return forward(config, payload, event).catch((cause) => {
    console.error(cause);
    return { event, status: 0, runIds: [] };
  });
}

import "server-only";
import { randomUUID } from "node:crypto";
import {
  HttpError,
  demoConnectors,
  hubSignature,
  mockLog,
  postToOwnWebhook,
  slackSignature,
  type MockEntry,
} from "glove-foundry-web-kit/server";
import type { DeliveryHop, MockBubble } from "glove-foundry-web-kit/shared";
import { host } from "./host";
import { teamOf } from "./dot";

// The demo connectors (DEMO_CONNECTORS=1, scripts/demo-connectors.mjs): a mock
// Slack and mock mail, served by this web app. What the page sends goes to
// the app's own webhooks at its public address, signed the way Slack signs,
// and the dot's posts come back through the mock Web API (app/mock/slack).
// Every hop lands in one log, which the page reads.

/** At most this many sends per person per hour: each one can start a model run. */
const PER_HOUR = 30;

export async function demoLog() {
  if (!demoConnectors()) throw new HttpError(404, "The demo connectors are off here.");
  return mockLog((await host()).dataDir);
}

/** Where the page can write from: the owner's DM with the bot, #feedback, and a teammate's DM. */
export type SlackPlace = "dm" | "channel" | "teammate";

/** Each person gets their own mock channels, so two demos never mix. */
function places(personId: string, owner: string, dot: string) {
  const tag = personId.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return {
    dm: { channel: `D0${tag}`, user: owner, label: `Your DM with ${dot}` },
    channel: { channel: `C0FB${tag}`, user: owner, label: "#feedback" },
    teammate: { channel: `D0${tag}X`, user: `U0${tag}MATE`, label: "A teammate's DM" },
  } as const;
}

async function identities(personId: string) {
  const team = await teamOf(personId);
  if (!team) throw new HttpError(404, "You have no dot yet.");
  const owner = team.data.slackUserId;
  const gmail = await (await host()).accounts.readAccount(`${personId}-gmail`);
  const email = typeof gmail?.metadata.email === "string" ? gmail.metadata.email : undefined;
  return { name: team.data.name, owner, email, accountId: gmail?.id, places: owner ? places(personId, owner, team.data.name) : undefined };
}

export interface DemoState {
  readonly dot: string;
  readonly slack: boolean;
  readonly email: string | null;
  readonly places: Readonly<Record<SlackPlace, { readonly label: string }>> | null;
  /** The conversation in each place, oldest first. */
  readonly conversations: Readonly<Record<SlackPlace, ReadonlyArray<MockBubble>>>;
  readonly hops: ReadonlyArray<DeliveryHop>;
}

export async function demoState(personId: string): Promise<DemoState> {
  const { name, email, places: where } = await identities(personId);
  const channels = where ? Object.entries(where).map(([place, value]) => [value.channel, place as SlackPlace] as const) : [];
  const placeOf = new Map<string, SlackPlace>(channels);
  const entries = await (await demoLog()).list((entry) => entry.person === personId || (typeof entry.channel === "string" && placeOf.has(entry.channel)));
  const conversations: Record<SlackPlace, MockBubble[]> = { dm: [], channel: [], teammate: [] };
  for (const entry of entries) {
    const place = typeof entry.channel === "string" ? placeOf.get(entry.channel) : undefined;
    if (entry.connector !== "slack" || entry.direction === "hop" || !place) continue;
    conversations[place].push({
      id: entry.id,
      side: entry.direction === "in" ? "me" : "them",
      text: String(entry.text ?? ""),
      at: entry.at,
      ...(entry.direction === "in" && typeof entry.status === "number" && entry.status !== 200 ? { note: `webhook answered ${entry.status}` } : {}),
    });
  }
  return {
    dot: name,
    slack: Boolean(where),
    email: email ?? null,
    places: where ? { dm: { label: where.dm.label }, channel: { label: where.channel.label }, teammate: { label: where.teammate.label } } : null,
    conversations,
    hops: entries.map((entry) => hopOf(entry, name, placeOf)),
  };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function hopOf(entry: MockEntry, dot: string, placeOf: ReadonlyMap<string, SlackPlace>): DeliveryHop {
  const status = typeof entry.status === "number" ? entry.status : 0;
  const runs = Array.isArray(entry.runIds) ? entry.runIds.length : 0;
  const where = { dm: "your DM", channel: "#feedback", teammate: "a teammate's DM" }[placeOf.get(String(entry.channel)) ?? "dm"];
  const base = { id: entry.id, at: entry.at, direction: entry.direction };
  if (entry.direction === "in") {
    const what = entry.connector === "slack" ? `Slack delivered a message in ${where}` : `Mail from ${String(entry.from)} arrived`;
    return { ...base, title: `${what}, signed`, detail: `POST ${String(entry.url)} → ${status}`, ok: status === 200 };
  }
  if (entry.direction === "hop") {
    const title = status === 202
      ? runs ? `Foundry took it on ${String(entry.route)} and started ${plural(runs, "run")}` : `Foundry took it on ${String(entry.route)}; no playbook matched, so nothing ran`
      : `Foundry refused it on ${String(entry.route)} (${status || "no answer"})`;
    return { ...base, title, ...(runs ? { detail: (entry.runIds as string[]).join(", ") } : {}), ok: status === 202 };
  }
  return { ...base, title: `${dot} posted in ${where}`, detail: `POST ${String(entry.path)}`, ok: true };
}

async function withinLimit(personId: string): Promise<void> {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const sent = await (await demoLog()).list((entry) => entry.person === personId && entry.direction === "in" && Date.parse(entry.at) > hourAgo);
  if (sent.length >= PER_HOUR) throw new HttpError(429, `That's ${PER_HOUR} this hour. Try again later.`);
}

/** A Slack message to the bot: a DM from the owner, a mention in #feedback, or a teammate's DM. */
export async function sendSlack(personId: string, place: SlackPlace, text: string): Promise<{ readonly status: number }> {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) throw new HttpError(404, "The mock Slack is off here.");
  await withinLimit(personId);
  const { places: where } = await identities(personId);
  if (!where) throw new HttpError(409, "Your dot isn't in Slack.");
  const { channel, user } = where[place];
  const bot = process.env.SLACK_BOT_USER_ID ?? "U0000000BOT";
  const now = Date.now();
  const ts = `${Math.floor(now / 1000)}.${String(now % 1000).padStart(3, "0")}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
  const event = place === "channel"
    ? { type: "app_mention", user, text: `<@${bot}> ${text}`, ts, channel, event_ts: ts }
    : { type: "message", channel_type: "im", user, text, ts, channel, event_ts: ts };
  const body = JSON.stringify({
    token: "mock",
    team_id: process.env.SLACK_TEAM_ID ?? "T0000000000",
    api_app_id: process.env.SLACK_APP_ID ?? "A0000000000",
    type: "event_callback",
    event_id: `Ev${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
    event_time: Math.floor(now / 1000),
    event,
  });
  const timestamp = String(Math.floor(now / 1000));
  const sent = await postToOwnWebhook("/webhooks/slack", body, {
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": slackSignature(body, timestamp, secret),
  });
  await (await demoLog()).append({ connector: "slack", direction: "in", person: personId, channel, user, text, url: sent.url, status: sent.status });
  return { status: sent.status };
}

/** New mail for the support inbox the dot watches, as if a customer had just written. */
export async function sendMail(personId: string, mail: { readonly from: string; readonly subject: string; readonly body: string }): Promise<{ readonly status: number }> {
  const secret = process.env.MOCK_MAIL_SECRET;
  if (!secret) throw new HttpError(404, "The mock mail is off here.");
  await withinLimit(personId);
  const { email, accountId } = await identities(personId);
  if (!email || !accountId) throw new HttpError(409, "Your dot has no mailbox connected.");
  const id = `m-mock-${randomUUID().slice(0, 8)}`;
  const body = JSON.stringify({
    person: personId,
    account: accountId,
    email,
    message: { id, threadId: id.replace("m-", "t-"), from: mail.from, subject: mail.subject, body: mail.body, receivedAt: new Date().toISOString() },
  });
  const sent = await postToOwnWebhook("/webhooks/mail", body, { "x-demo-signature": hubSignature(body, secret) });
  await (await demoLog()).append({ connector: "mail", direction: "in", person: personId, from: mail.from, subject: mail.subject, url: sent.url, status: sent.status });
  return { status: sent.status };
}

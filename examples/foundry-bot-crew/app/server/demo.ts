import "server-only";
import { randomUUID } from "node:crypto";
import {
  HttpError,
  demoConnectors,
  hubSignature,
  mockLog,
  ownedAgents,
  postToOwnWebhook,
  type MockEntry,
} from "glove-foundry-web-kit/server";
import type { DeliveryHop } from "glove-foundry-web-kit/shared";
import { host } from "./host";

// The demo connector (DEMO_CONNECTORS=1, scripts/demo-connectors.mjs): a mock
// mail, served by this web app. What the page sends goes to the app's own
// webhook at its public address, signed, and lands in the person's sample
// Gmail; each bot with a routine on new mail wakes in its chat. Every hop
// lands in one log, which the page reads.

/** At most this many sends per person per hour: each one can wake several bots. */
const PER_HOUR = 20;

export async function demoLog() {
  if (!demoConnectors()) throw new HttpError(404, "The demo connectors are off here.");
  return mockLog((await host()).dataDir);
}

async function mailbox(personId: string) {
  const gmail = await (await host()).accounts.readAccount(`${personId}-gmail`);
  const email = typeof gmail?.metadata.email === "string" ? gmail.metadata.email : undefined;
  return { email, accountId: gmail?.id };
}

export interface DemoState {
  readonly email: string | null;
  /** The bots the latest mail woke, to open their chats. */
  readonly woke: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly hops: ReadonlyArray<DeliveryHop>;
}

export async function demoState(personId: string): Promise<DemoState> {
  const [{ email }, bots, entries] = await Promise.all([
    mailbox(personId),
    ownedAgents(personId, "bot"),
    demoLog().then((log) => log.list((entry) => entry.person === personId)),
  ]);
  const names = new Map(bots.map((bot) => [bot.id, bot.name ?? "New bot"]));
  const latest = [...entries].reverse().find((entry) => entry.direction === "hop");
  const woke = (Array.isArray(latest?.agentIds) ? latest.agentIds as string[] : [])
    .flatMap((id) => (names.has(id) ? [{ id, name: names.get(id)! }] : []));
  return { email: email ?? null, woke, hops: entries.map((entry) => hopOf(entry, names)) };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function hopOf(entry: MockEntry, names: ReadonlyMap<string, string>): DeliveryHop {
  const status = typeof entry.status === "number" ? entry.status : 0;
  const base = { id: entry.id, at: entry.at, direction: entry.direction };
  if (entry.direction === "in") {
    return { ...base, title: `Mail from ${String(entry.from)} arrived, signed`, detail: `POST ${String(entry.url)} → ${status}`, ok: status === 200 };
  }
  const agents = Array.isArray(entry.agentIds) ? (entry.agentIds as string[]).map((id) => names.get(id) ?? id) : [];
  const title = status !== 202
    ? `Foundry refused it on ${String(entry.route)} (${status || "no answer"})`
    : agents.length ? `Foundry took it on ${String(entry.route)} and woke ${plural(agents.length, "bot")}: ${agents.join(", ")}`
    : `Foundry took it on ${String(entry.route)}; no bot has a routine on new mail, so nothing ran`;
  const runs = Array.isArray(entry.runIds) ? entry.runIds as string[] : [];
  return { ...base, title, ...(runs.length ? { detail: runs.join(", ") } : {}), ok: status === 202 };
}

async function withinLimit(personId: string): Promise<void> {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const sent = await (await demoLog()).list((entry) => entry.person === personId && entry.direction === "in" && Date.parse(entry.at) > hourAgo);
  if (sent.length >= PER_HOUR) throw new HttpError(429, `That's ${PER_HOUR} this hour. Try again later.`);
}

/** New mail for the person's Gmail, as if someone had just written to them. */
export async function sendMail(personId: string, mail: { readonly from: string; readonly subject: string; readonly body: string }): Promise<{ readonly status: number }> {
  const secret = process.env.MOCK_MAIL_SECRET;
  if (!secret) throw new HttpError(404, "The mock mail is off here.");
  await withinLimit(personId);
  const { email, accountId } = await mailbox(personId);
  if (!email || !accountId) throw new HttpError(409, "Connect Gmail on the Apps page first.");
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

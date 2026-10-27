import "server-only";
import { randomUUID } from "node:crypto";
import {
  HttpError,
  demoConnectors,
  hubSignature,
  mockLog,
  postToOwnWebhook,
  type MockEntry,
} from "glove-foundry-web-kit/server";
import type { DeliveryHop, MockBubble } from "glove-foundry-web-kit/shared";
import { host } from "./host";
import { museOf, phoneOf } from "./muse";

// The demo connectors (DEMO_CONNECTORS=1, scripts/demo-connectors.mjs): a mock
// WhatsApp and mock mail, served by this web app. What the page sends goes to
// the app's own webhooks at its public address, signed the way Meta signs,
// and Muse's answers come back through the mock Graph API
// (app/mock/whatsapp). Every hop lands in one log, which the page reads.

/** A number no person here has: the page can write from it to show that a stranger wakes nothing. */
const STRANGER = "15550188888";
/** At most this many sends per person per hour: each one starts a model run. */
const PER_HOUR = 30;

export async function demoLog() {
  if (!demoConnectors()) throw new HttpError(404, "The demo connectors are off here.");
  return mockLog((await host()).dataDir);
}

/** The signed-in person's phone, their Gmail address and the stranger's number. */
async function identities(personId: string) {
  const muse = await museOf(personId);
  const phone = typeof muse.context.phone === "string" ? muse.context.phone : undefined;
  const gmail = await (await host()).accounts.readAccount(`${personId}-gmail`);
  const email = typeof gmail?.metadata.email === "string" ? gmail.metadata.email : undefined;
  return { phone, email, stranger: STRANGER, accountId: gmail?.id };
}

const mine = (personId: string, phones: ReadonlyArray<string | undefined>) => (entry: MockEntry) =>
  entry.person === personId || (typeof entry.phone === "string" && phones.includes(entry.phone));

export interface DemoState {
  readonly phone: string | null;
  readonly email: string | null;
  readonly stranger: string;
  /** The WhatsApp conversation from each number, oldest first. */
  readonly whatsapp: Readonly<Record<string, ReadonlyArray<MockBubble>>>;
  readonly hops: ReadonlyArray<DeliveryHop>;
}

export async function demoState(personId: string): Promise<DemoState> {
  const { phone, email, stranger } = await identities(personId);
  const entries = await (await demoLog()).list(mine(personId, [phone, stranger]));
  const whatsapp: Record<string, MockBubble[]> = {};
  for (const entry of entries) {
    if (entry.connector !== "whatsapp" || entry.direction === "hop" || typeof entry.phone !== "string") continue;
    (whatsapp[entry.phone] ??= []).push({
      id: entry.id,
      side: entry.direction === "in" ? "me" : "them",
      text: String(entry.text ?? ""),
      at: entry.at,
      ...(entry.direction === "in" && typeof entry.status === "number" && entry.status !== 200 ? { note: `webhook answered ${entry.status}` } : {}),
    });
  }
  return { phone: phone ?? null, email: email ?? null, stranger, whatsapp, hops: entries.map((entry) => hopOf(entry, phone)) };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function hopOf(entry: MockEntry, phone: string | undefined): DeliveryHop {
  const who = entry.phone === phone ? "your phone" : entry.phone ? `${phoneOf(String(entry.phone))} (a stranger)` : "";
  const status = typeof entry.status === "number" ? entry.status : 0;
  const runs = Array.isArray(entry.runIds) ? entry.runIds.length : 0;
  const base = { id: entry.id, at: entry.at, direction: entry.direction };
  if (entry.direction === "in") {
    const what = entry.connector === "whatsapp" ? `WhatsApp delivered a message from ${who}` : `Mail from ${String(entry.from)} arrived`;
    return { ...base, title: `${what}, signed`, detail: `POST ${String(entry.url)} → ${status}`, ok: status === 200 };
  }
  if (entry.direction === "hop") {
    const title = status === 202
      ? runs ? `Foundry took it on ${String(entry.route)} and started ${plural(runs, "run")}` : `Foundry took it on ${String(entry.route)}; no playbook matched, so nothing ran`
      : `Foundry refused it on ${String(entry.route)} (${status || "no answer"})`;
    return { ...base, title, ...(runs ? { detail: (entry.runIds as string[]).join(", ") } : {}), ok: status === 202 };
  }
  return { ...base, title: `Muse sent a WhatsApp to ${who}`, detail: `POST ${String(entry.path)}`, ok: true };
}

async function withinLimit(personId: string): Promise<void> {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const sent = await (await demoLog()).list((entry) => entry.person === personId && entry.direction === "in" && Date.parse(entry.at) > hourAgo);
  if (sent.length >= PER_HOUR) throw new HttpError(429, `That's ${PER_HOUR} this hour. Try again later.`);
}

/** A WhatsApp message from the person's phone, or from a stranger's, to Muse's number. */
export async function sendWhatsApp(personId: string, from: "me" | "stranger", text: string): Promise<{ readonly status: number }> {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) throw new HttpError(404, "The mock WhatsApp is off here.");
  await withinLimit(personId);
  const { phone, stranger } = await identities(personId);
  const number = from === "me" ? phone : stranger;
  if (!number) throw new HttpError(409, "Your Muse has no WhatsApp number.");
  const messageId = `wamid.mock.${randomUUID()}`;
  const delivery = {
    object: "whatsapp_business_account",
    entry: [{
      id: "mock-waba",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550100000", phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "100000000000001" },
          contacts: [{ wa_id: number, profile: { name: from === "me" ? "You" : "Stranger" } }],
          messages: [{ from: number, id: messageId, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
        },
      }],
    }],
  };
  const body = JSON.stringify(delivery);
  const sent = await postToOwnWebhook("/webhooks/whatsapp", body, { "x-hub-signature-256": hubSignature(body, secret) });
  await (await demoLog()).append({ connector: "whatsapp", direction: "in", person: personId, phone: number, text, messageId, url: sent.url, status: sent.status });
  return { status: sent.status };
}

/** New mail for the person's Gmail, as if someone had just written to them. */
export async function sendMail(personId: string, mail: { readonly from: string; readonly subject: string; readonly body: string }): Promise<{ readonly status: number }> {
  const secret = process.env.MOCK_MAIL_SECRET;
  if (!secret) throw new HttpError(404, "The mock mail is off here.");
  await withinLimit(personId);
  const { email, accountId } = await identities(personId);
  if (!email || !accountId) throw new HttpError(409, "You have no Gmail connected.");
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

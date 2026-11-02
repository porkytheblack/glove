import { createHmac, timingSafeEqual } from "node:crypto";

// Meta's WhatsApp webhook, forwarded to Foundry's whatsapp-in route. Meta needs
// two things Foundry does not do itself: the verify-token handshake when you
// register the URL, and a signature check on every delivery
// (X-Hub-Signature-256, an HMAC of the body with the app secret). The web app
// serves this at /webhooks/whatsapp, in the same unit as Foundry; the
// standalone scripts/whatsapp-webhook.ts does the same for local runs.

export interface WhatsAppWebhookConfig {
  readonly appSecret: string;
  readonly verifyToken: string;
  readonly foundryUrl: string;
  readonly foundryToken?: string;
}

export function webhookConfig(): WhatsAppWebhookConfig | undefined {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!appSecret || !verifyToken) return undefined;
  return {
    appSecret,
    verifyToken,
    foundryUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4149",
    ...(process.env.FOUNDRY_TOKEN ? { foundryToken: process.env.FOUNDRY_TOKEN } : {}),
  };
}

/** Registering the webhook: the challenge to echo, if the token is ours. */
export function challenge(params: URLSearchParams, verifyToken: string): string | undefined {
  const ok = params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === verifyToken;
  return ok ? params.get("hub.challenge") ?? "" : undefined;
}

export function signed(body: Buffer, signature: string, appSecret: string): boolean {
  const expected = Buffer.from(`sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface Message { readonly id: string; readonly from: string; readonly type: string }
interface Delivery {
  readonly entry?: ReadonlyArray<{ readonly changes?: ReadonlyArray<{ readonly value?: { readonly messages?: ReadonlyArray<Message> } }> }>;
}

/**
 * One delivery per text message, each holding only that message. Status
 * updates (sent, delivered, read) carry no messages and are skipped.
 */
export function textMessages(delivery: Delivery): ReadonlyArray<{ readonly message: Message; readonly raw: Delivery }> {
  const out: Array<{ message: Message; raw: Delivery }> = [];
  for (const entry of delivery.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.type !== "text") continue;
        out.push({ message, raw: { ...delivery, entry: [{ ...entry, changes: [{ ...change, value: { ...change.value, messages: [message] } }] }] } });
      }
    }
  }
  return out;
}

/** What Foundry answered for one message: its status, and the runs it started. */
export interface Forwarded {
  readonly message: Message;
  readonly status: number;
  readonly runIds: ReadonlyArray<string>;
}

export async function forward(config: WhatsAppWebhookConfig, raw: Delivery, message: Message): Promise<Forwarded> {
  const response = await fetch(`${config.foundryUrl}/api/transmissions/whatsapp-in/fire`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.foundryToken ? { authorization: `Bearer ${config.foundryToken}` } : {}),
    },
    body: JSON.stringify({
      // Meta retries a delivery it isn't sure of; the same message id is only handled once.
      eventId: message.id,
      threadKey: message.from,
      // Every WhatsApp message from a person joins their Muse's WhatsApp conversation.
      conversationKey: "whatsapp",
      conversationScope: "agent",
      raw,
    }),
  });
  const text = await response.text();
  if (!response.ok) console.error(`Foundry refused ${message.id}: ${response.status} ${text}`);
  const runs = response.ok ? (JSON.parse(text) as ReadonlyArray<{ readonly id: string }>) : [];
  return { message, status: response.status, runIds: runs.map((run) => run.id) };
}

/** Forward every text message in a signed delivery; what Foundry answered for each. */
export async function forwardDelivery(config: WhatsAppWebhookConfig, body: Buffer): Promise<ReadonlyArray<Forwarded>> {
  const results: Forwarded[] = [];
  for (const { message, raw } of textMessages(JSON.parse(body.toString("utf8")) as Delivery)) {
    const result = await forward(config, raw, message).catch((cause) => {
      console.error(cause);
      return { message, status: 0, runIds: [] };
    });
    results.push(result);
  }
  return results;
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

// Receives Meta's WhatsApp webhook and forwards each text message to Foundry's
// whatsapp-in route. Meta needs two things Foundry does not do itself: the
// verify-token handshake when you register the URL, and a signature check on
// every delivery (X-Hub-Signature-256, an HMAC of the body with the app secret).
//   WHATSAPP_APP_SECRET=… WHATSAPP_VERIFY_TOKEN=… FOUNDRY_URL=http://127.0.0.1:4149 pnpm whatsapp-webhook

const secret = process.env.WHATSAPP_APP_SECRET ?? "";
const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
const foundryUrl = process.env.FOUNDRY_URL ?? "http://127.0.0.1:4149";
const port = Number(process.env.PORT ?? 4150);
if (!secret || !verifyToken) throw new Error("Set WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN.");

function signed(body: Buffer, signature: string): boolean {
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface Message { readonly id: string; readonly from: string; readonly type: string }
interface Delivery {
  readonly entry?: ReadonlyArray<{ readonly changes?: ReadonlyArray<{ readonly value?: { readonly messages?: ReadonlyArray<Message> } }> }>;
}

async function forward(raw: Delivery, message: Message): Promise<void> {
  const response = await fetch(`${foundryUrl}/api/transmissions/whatsapp-in/fire`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.FOUNDRY_TOKEN ? { authorization: `Bearer ${process.env.FOUNDRY_TOKEN}` } : {}),
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
  if (!response.ok) console.error(`Foundry refused ${message.id}: ${response.status} ${await response.text()}`);
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET") {
    // Registering the webhook: echo the challenge if the token is ours.
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === verifyToken;
    response.writeHead(ok ? 200 : 403, { "content-type": "text/plain" });
    return void response.end(ok ? url.searchParams.get("hub.challenge") ?? "" : "");
  }
  if (request.method !== "POST") return void response.writeHead(405).end();
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  if (!signed(body, String(request.headers["x-hub-signature-256"] ?? ""))) return void response.writeHead(401).end();
  response.writeHead(200).end();
  const delivery = JSON.parse(body.toString("utf8")) as Delivery;
  // One event per text message, each in a delivery of its own. Status updates
  // (sent, delivered, read) carry no messages and are skipped.
  for (const entry of delivery.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.type !== "text") continue;
        const one = { ...delivery, entry: [{ ...entry, changes: [{ ...change, value: { ...change.value, messages: [message] } }] }] };
        await forward(one, message).catch((cause) => console.error(cause));
      }
    }
  }
}).listen(port, () => console.log(`WhatsApp webhook on :${port}, forwarding to ${foundryUrl}`));

import { createServer } from "node:http";
import { challenge, forwardDelivery, signed, webhookConfig } from "../lib/whatsapp-webhook.js";

// Meta's WhatsApp webhook on its own port, for local runs. On Kuiper the web
// app serves the same thing at /webhooks/whatsapp (lib/whatsapp-webhook.ts).
//   WHATSAPP_APP_SECRET=… WHATSAPP_VERIFY_TOKEN=… FOUNDRY_URL=http://127.0.0.1:4149 pnpm whatsapp-webhook

const config = webhookConfig();
if (!config) throw new Error("Set WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN.");
const port = Number(process.env.PORT ?? 4150);

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET") {
    const echo = challenge(url.searchParams, config.verifyToken);
    response.writeHead(echo === undefined ? 403 : 200, { "content-type": "text/plain" });
    return void response.end(echo ?? "");
  }
  if (request.method !== "POST") return void response.writeHead(405).end();
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  if (!signed(body, String(request.headers["x-hub-signature-256"] ?? ""), config.appSecret)) return void response.writeHead(401).end();
  response.writeHead(200).end();
  await forwardDelivery(config, body);
}).listen(port, () => console.log(`WhatsApp webhook on :${port}, forwarding to ${config.foundryUrl}`));

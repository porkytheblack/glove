import { after } from "next/server";
import { challenge, forwardDelivery, signed, webhookConfig } from "../../../lib/whatsapp-webhook";

// Meta's WhatsApp webhook, in the same unit as Foundry: register
// <WEB_URL>/webhooks/whatsapp with Meta. Meta signs every delivery, so this
// route needs no sign-in; an unsigned one is refused.

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const config = webhookConfig();
  if (!config) return new Response("WhatsApp isn't set up here.", { status: 404 });
  const echo = challenge(new URL(request.url).searchParams, config.verifyToken);
  return new Response(echo ?? "", { status: echo === undefined ? 403 : 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request): Promise<Response> {
  const config = webhookConfig();
  if (!config) return new Response(null, { status: 404 });
  const body = Buffer.from(await request.arrayBuffer());
  if (!signed(body, request.headers.get("x-hub-signature-256") ?? "", config.appSecret)) return new Response(null, { status: 401 });
  // Answer Meta at once; forward after the response.
  after(() => forwardDelivery(config, body));
  return new Response(null, { status: 200 });
}

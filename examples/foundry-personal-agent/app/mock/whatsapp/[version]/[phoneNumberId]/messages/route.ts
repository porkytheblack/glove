import { randomUUID } from "node:crypto";
import { bearer, demoConnectors, mockLog } from "glove-foundry-web-kit/server";
import { host } from "../../../../../server/host";

// The mock WhatsApp's Graph API: what Muse's sends reach when
// DEMO_CONNECTORS=1 points WHATSAPP_GRAPH_URL here. The same request and
// answer as Meta's POST /{version}/{phone-number-id}/messages, for text.

export const dynamic = "force-dynamic";

const graphError = (status: number, message: string, code: number) => Response.json({ error: { message, type: "OAuthException", code } }, { status });

export async function POST(request: Request, { params }: { params: Promise<{ phoneNumberId: string }> }): Promise<Response> {
  if (!demoConnectors()) return new Response(null, { status: 404 });
  if (!bearer(request, process.env.WHATSAPP_TOKEN)) return graphError(401, "Invalid OAuth access token.", 190);
  const message = await request.json().catch(() => undefined) as { readonly to?: unknown; readonly type?: unknown; readonly text?: { readonly body?: unknown } } | undefined;
  const to = message?.to;
  const text = message?.text?.body;
  if (typeof to !== "string" || !/^\d{6,15}$/.test(to) || message?.type !== "text" || typeof text !== "string" || !text) {
    return graphError(400, "This mock takes text messages to a phone number.", 100);
  }
  const { phoneNumberId } = await params;
  const id = `wamid.mock.${randomUUID()}`;
  await mockLog((await host()).dataDir).append({ connector: "whatsapp", direction: "out", phone: to, text, messageId: id, phoneNumberId, path: new URL(request.url).pathname });
  return Response.json({ messaging_product: "whatsapp", contacts: [{ input: to, wa_id: to }], messages: [{ id }] });
}

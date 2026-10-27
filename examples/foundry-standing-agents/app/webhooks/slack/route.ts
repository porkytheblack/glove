import { after } from "next/server";
import { demoConnectors, mockLog } from "glove-foundry-web-kit/server";
import { forwardPayload, signed, slackConfig, type SlackPayload } from "../../../lib/slack-events";
import { host } from "../../server/host";

// Slack's Events API, in the same unit as Foundry: set <WEB_URL>/webhooks/slack
// as the Slack app's request URL. Slack signs every delivery, so this route
// needs no sign-in; an unsigned one is refused.

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const config = slackConfig();
  if (!config) return new Response(null, { status: 404 });
  const body = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";
  if (!signed(body, timestamp, signature, config.signingSecret)) return new Response(null, { status: 401 });
  const payload = JSON.parse(body) as SlackPayload;
  if (payload.type === "url_verification") {
    return new Response(payload.challenge ?? "", { headers: { "content-type": "text/plain" } });
  }
  // Slack wants an answer within three seconds; forward after answering.
  after(async () => {
    const result = await forwardPayload(config, payload);
    if (!result || !demoConnectors()) return;
    // The demo page shows what Foundry did with each message.
    const { event, status, runIds } = result;
    await mockLog((await host()).dataDir).append({ connector: "slack", direction: "hop", channel: event.channel, user: event.user, eventId: payload.event_id, route: "slack-messages", status, runIds });
  });
  return new Response(null, { status: 200 });
}

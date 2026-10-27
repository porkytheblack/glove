import { createServer } from "node:http";
import { forwardPayload, signed, slackConfig, type SlackPayload } from "../lib/slack-events.js";

// Slack's Events API on its own port, for local runs. On Kuiper the web app
// serves the same thing at /webhooks/slack (lib/slack-events.ts).
//   SLACK_SIGNING_SECRET=… FOUNDRY_URL=http://127.0.0.1:4145 pnpm slack-events

const config = slackConfig();
if (!config) throw new Error("Set SLACK_SIGNING_SECRET to the Slack app's signing secret.");
const port = Number(process.env.PORT ?? 4146);

createServer(async (request, response) => {
  if (request.method !== "POST") return void response.writeHead(405).end();
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");
  const timestamp = String(request.headers["x-slack-request-timestamp"] ?? "");
  const signature = String(request.headers["x-slack-signature"] ?? "");
  if (!signed(body, timestamp, signature, config.signingSecret)) return void response.writeHead(401).end();

  const payload = JSON.parse(body) as SlackPayload;
  if (payload.type === "url_verification") {
    response.writeHead(200, { "content-type": "text/plain" });
    return void response.end(payload.challenge ?? "");
  }
  // Slack wants an answer within three seconds; forward after answering.
  response.writeHead(200).end();
  await forwardPayload(config, payload);
}).listen(port, () => console.log(`Slack events on :${port}, forwarding to ${config.foundryUrl}`));

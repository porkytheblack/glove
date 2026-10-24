import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

// Receives X's Account Activity webhook and forwards each mention of the bot to
// Foundry's x-mentions route. X needs two things Foundry does not do itself:
// an answer to its CRC check, and a signature check on every delivery.
//   X_CONSUMER_SECRET=… FOUNDRY_URL=http://127.0.0.1:4143 pnpm x-webhook

const secret = process.env.X_CONSUMER_SECRET ?? "";
const foundryUrl = process.env.FOUNDRY_URL ?? "http://127.0.0.1:4143";
const port = Number(process.env.PORT ?? 4144);
if (!secret) throw new Error("Set X_CONSUMER_SECRET to the X app's consumer secret.");

const sign = (data: string | Buffer) => `sha256=${createHmac("sha256", secret).update(data).digest("base64")}`;

interface XTweet {
  readonly id_str: string;
  readonly text: string;
  readonly extended_tweet?: { readonly full_text: string };
  readonly user: { readonly id_str: string; readonly screen_name: string };
  readonly in_reply_to_status_id_str: string | null;
  readonly quoted_status?: { readonly text: string };
}

/** The post a mention replied to, so "@crewbot what does this mean?" has its subject. */
async function parentText(tweetId: string | null): Promise<string | undefined> {
  if (!tweetId || !process.env.X_BEARER_TOKEN) return undefined;
  const response = await fetch(`https://api.x.com/2/tweets/${tweetId}`, {
    headers: { authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
  });
  return response.ok ? ((await response.json()) as { data?: { text?: string } }).data?.text : undefined;
}

async function forward(botUserId: string, tweet: XTweet): Promise<void> {
  const repliedTo = await parentText(tweet.in_reply_to_status_id_str);
  const response = await fetch(`${foundryUrl}/api/transmissions/x-mentions/fire`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.FOUNDRY_TOKEN ? { authorization: `Bearer ${process.env.FOUNDRY_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      eventId: tweet.id_str,
      threadKey: tweet.id_str,
      // Every mention from a person joins the one thread they read.
      conversationKey: "main",
      conversationScope: "agent",
      raw: {
        for_user_id: botUserId,
        tweet: {
          id_str: tweet.id_str,
          text: tweet.extended_tweet?.full_text ?? tweet.text,
          user: tweet.user,
          in_reply_to_status_id_str: tweet.in_reply_to_status_id_str,
          ...(repliedTo ? { replied_to_text: repliedTo } : {}),
          ...(tweet.quoted_status ? { quoted_text: tweet.quoted_status.text } : {}),
        },
      },
    }),
  });
  if (!response.ok) console.error(`Foundry refused ${tweet.id_str}: ${response.status} ${await response.text()}`);
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET") {
    // X's challenge-response check, on registration and every so often after.
    const token = url.searchParams.get("crc_token");
    if (!token) return void response.writeHead(400).end();
    response.writeHead(200, { "content-type": "application/json" });
    return void response.end(JSON.stringify({ response_token: sign(token) }));
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(String(request.headers["x-twitter-webhooks-signature"] ?? ""));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return void response.writeHead(401).end();
  }
  response.writeHead(200).end();
  const hook = JSON.parse(body.toString("utf8")) as { for_user_id: string; tweet_create_events?: XTweet[] };
  for (const tweet of hook.tweet_create_events ?? []) {
    if (tweet.user.id_str === hook.for_user_id) continue; // the bot's own posts
    await forward(hook.for_user_id, tweet).catch((cause) => console.error(cause));
  }
}).listen(port, () => console.log(`X webhook on :${port}, forwarding to ${foundryUrl}`));

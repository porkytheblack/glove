import { appendFile, mkdir } from "node:fs/promises";
import { dataDir, dataPath } from "./paths.js";

/** Used when X_BOT_TOKEN is not set: replies are written to .data/x-outbox.jsonl. */
export const OFFLINE_X_TOKEN = "offline";

/** Reply to a post as the bot account (X API v2, POST /2/tweets). */
export async function replyOnX(
  token: string,
  reply: { readonly inReplyTo: string; readonly text: string },
  signal?: AbortSignal,
): Promise<{ readonly tweetId: string }> {
  if (token === OFFLINE_X_TOKEN) {
    await mkdir(dataDir, { recursive: true });
    await appendFile(dataPath("x-outbox.jsonl"), `${JSON.stringify({ ...reply, at: new Date().toISOString() })}\n`);
    return { tweetId: `offline-${Date.now()}` };
  }
  const response = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ text: reply.text, reply: { in_reply_to_tweet_id: reply.inReplyTo } }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`X refused the reply (${response.status}): ${await response.text()}`);
  const body = (await response.json()) as { readonly data: { readonly id: string } };
  return { tweetId: body.data.id };
}

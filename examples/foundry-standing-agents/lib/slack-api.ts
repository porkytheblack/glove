import { appendFile, mkdir } from "node:fs/promises";
import { dataDir, dataPath } from "./paths.js";

/** Used when SLACK_BOT_TOKEN is not set: posts are written to .data/slack-outbox.jsonl. */
export const OFFLINE_SLACK_TOKEN = "offline";

export interface SlackPost {
  /** A channel id, or a user id to post in the bot's DM with them. */
  readonly channel: string;
  readonly text: string;
  readonly thread_ts?: string;
}

/** Slack's Web API, or the mock Slack the web app serves when DEMO_CONNECTORS=1. */
const slackApi = () => (process.env.SLACK_API_URL ?? "https://slack.com/api").replace(/\/$/, "");

/** Post as the bot (Slack Web API, chat.postMessage). */
export async function postToSlack(token: string, post: SlackPost, signal?: AbortSignal): Promise<{ readonly ts: string }> {
  if (token === OFFLINE_SLACK_TOKEN) {
    await mkdir(dataDir, { recursive: true });
    await appendFile(dataPath("slack-outbox.jsonl"), `${JSON.stringify({ ...post, at: new Date().toISOString() })}\n`);
    return { ts: `offline-${Date.now()}` };
  }
  const response = await fetch(`${slackApi()}/chat.postMessage`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(post),
    ...(signal ? { signal } : {}),
  });
  // Slack answers 200 with { ok: false, error } when it refuses a post.
  const body = (await response.json()) as { readonly ok: boolean; readonly ts?: string; readonly error?: string };
  if (!response.ok || !body.ok) throw new Error(`Slack refused the post: ${body.error ?? response.status}`);
  return { ts: body.ts ?? "" };
}

import { createSign } from "node:crypto";

// Gmail and Pub/Sub over REST, for the Gmail app. New mail reaches us the way
// Google intends: users.watch tells Gmail to publish a notification to a
// Pub/Sub topic whenever the mailbox changes; we pull that subscription, then
// read history.list from the last historyId to see what arrived.
//   https://developers.google.com/workspace/gmail/api/guides/push

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DAY = 24 * 60 * 60 * 1000;

export class GmailError extends Error {
  constructor(readonly status: number, body: string) {
    super(`Gmail ${status}: ${body.slice(0, 300)}`);
  }
}

async function gmail<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${GMAIL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
  });
  if (!response.ok) throw new GmailError(response.status, await response.text());
  return response.json() as Promise<T>;
}

/** One new message, as the Gmail transmission passes it to an agent. */
export interface Mail {
  readonly messageId: string;
  readonly threadId: string;
  readonly from: string;
  readonly subject: string;
  readonly snippet: string;
  readonly receivedAt: string;
  /** The RFC 822 Message-ID, so a reply lands in the sender's thread too. */
  readonly rfcMessageId: string;
}

/** Ask Gmail to publish changes to the topic. Lasts 7 days; we renew daily, as Google recommends. */
export function watch(token: string, topicName: string, labelIds: ReadonlyArray<string>) {
  return gmail<{ historyId: string; expiration: string }>(token, "/watch", {
    method: "POST",
    body: JSON.stringify({ topicName, labelIds, labelFilterBehavior: "INCLUDE" }),
  });
}

/** Messages added since a historyId. A 404 means the id is too old and the caller must start over. */
export async function messagesSince(token: string, startHistoryId: string, labelId: string) {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let historyId = startHistoryId;
  do {
    const query = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", labelId, ...(pageToken ? { pageToken } : {}) });
    const page = await gmail<{
      history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>;
      historyId: string;
      nextPageToken?: string;
    }>(token, `/history?${query}`);
    for (const record of page.history ?? []) for (const added of record.messagesAdded ?? []) ids.add(added.message.id);
    historyId = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { ids: [...ids], historyId };
}

export async function readMail(token: string, id: string): Promise<Mail> {
  const query = new URLSearchParams({ format: "metadata" });
  for (const header of ["From", "Subject", "Date", "Message-ID"]) query.append("metadataHeaders", header);
  const message = await gmail<{
    id: string;
    threadId: string;
    snippet: string;
    internalDate: string;
    payload: { headers: Array<{ name: string; value: string }> };
  }>(token, `/messages/${id}?${query}`);
  const header = (name: string) =>
    message.payload.headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  return {
    messageId: message.id,
    threadId: message.threadId,
    from: header("From"),
    subject: header("Subject"),
    snippet: message.snippet,
    receivedAt: new Date(Number(message.internalDate)).toISOString(),
    rfcMessageId: header("Message-ID"),
  };
}

/** A header value Gmail accepts whatever the characters (RFC 2047). */
const encodeHeader = (value: string) =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;

export interface Outgoing {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly threadId?: string;
  readonly inReplyTo?: string;
}

/** users.messages.send with an RFC 2822 message. Replies keep the thread on both ends. */
export async function sendMail(token: string, mail: Outgoing, signal?: AbortSignal) {
  const lines = [
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    ...(mail.inReplyTo ? [`In-Reply-To: ${mail.inReplyTo}`, `References: ${mail.inReplyTo}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    mail.body,
  ];
  const sent = await gmail<{ id: string; threadId: string }>(token, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: Buffer.from(lines.join("\r\n")).toString("base64url"), ...(mail.threadId ? { threadId: mail.threadId } : {}) }),
    ...(signal ? { signal } : {}),
  });
  return { messageId: sent.id, threadId: sent.threadId };
}

// ── Pub/Sub ─────────────────────────────────────────────────────────────────
// Gmail publishes every watched mailbox to one topic. Pulling it needs the
// app's own Google Cloud identity: a service account allowed to subscribe.
// The topic must let gmail-api-push@system.gserviceaccount.com publish.

let pubsubToken: { readonly value: string; readonly expiresAt: number } | undefined;

async function serviceAccountToken(): Promise<string> {
  if (pubsubToken && pubsubToken.expiresAt - 60_000 > Date.now()) return pubsubToken.value;
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "{}") as { client_email?: string; private_key?: string };
  if (!key.client_email || !key.private_key) throw new Error("Set GOOGLE_SERVICE_ACCOUNT_JSON to the service account key that pulls the Gmail subscription.");
  const now = Math.floor(Date.now() / 1000);
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/pubsub",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`Service account token: ${response.status} ${await response.text()}`);
  const json = await response.json() as { access_token: string; expires_in: number };
  pubsubToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function pubsub<T>(subscription: string, verb: "pull" | "acknowledge", body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`https://pubsub.googleapis.com/v1/${subscription}:${verb}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await serviceAccountToken()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Pub/Sub ${verb}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

// One puller per process, shared by every watched mailbox: each connection
// registers its address and hears only its own notifications. Run one
// Foundry process per subscription, or notifications for mailboxes another
// process watches are acknowledged here and lost.
const listeners = new Map<string, Set<() => void>>();
let puller: AbortController | undefined;

function onMailbox(email: string, listener: () => void): () => void {
  const key = email.toLowerCase();
  const set = listeners.get(key) ?? new Set();
  set.add(listener);
  listeners.set(key, set);
  if (!puller) {
    puller = new AbortController();
    void pullLoop(puller.signal);
  }
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
    if (listeners.size === 0) {
      puller?.abort();
      puller = undefined;
    }
  };
}

async function pullLoop(signal: AbortSignal): Promise<void> {
  const subscription = process.env.GMAIL_PUBSUB_SUBSCRIPTION;
  if (!subscription) throw new Error("Set GMAIL_PUBSUB_SUBSCRIPTION to projects/<project>/subscriptions/<name>.");
  while (!signal.aborted) {
    try {
      const { receivedMessages = [] } = await pubsub<{
        receivedMessages?: Array<{ ackId: string; message: { data: string } }>;
      }>(subscription, "pull", { maxMessages: 100 }, signal);
      for (const { message } of receivedMessages) {
        const { emailAddress } = JSON.parse(Buffer.from(message.data, "base64").toString("utf8")) as { emailAddress: string };
        for (const listener of listeners.get(emailAddress.toLowerCase()) ?? []) listener();
      }
      // Acknowledged after dispatch. A redelivery is harmless: Foundry claims
      // each message once by route and Gmail message id.
      if (receivedMessages.length > 0) {
        await pubsub(subscription, "acknowledge", { ackIds: receivedMessages.map((item) => item.ackId) });
      }
    } catch (cause) {
      if (signal.aborted) return;
      console.warn("[gmail] pull failed, retrying in 5s:", cause instanceof Error ? cause.message : cause);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

/**
 * Watch one mailbox until the signal aborts: start the watch, renew it daily,
 * and on each notification read what arrived since the last historyId.
 * Messages are passed on one at a time, in order.
 */
export async function watchMailbox(options: {
  readonly email: string;
  readonly label: string;
  readonly token: () => Promise<string>;
  readonly onMail: (mail: Mail) => Promise<void>;
  readonly ready: () => Promise<void>;
  readonly signal: AbortSignal;
}): Promise<void> {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic) throw new Error("Set GMAIL_PUBSUB_TOPIC to projects/<project>/topics/<name>.");
  const start = async () => (await watch(await options.token(), topic, [options.label])).historyId;
  let historyId = await start();
  let queue = Promise.resolve();
  const sync = () => {
    queue = queue.then(async () => {
      const token = await options.token();
      try {
        const added = await messagesSince(token, historyId, options.label);
        for (const id of added.ids) await options.onMail(await readMail(token, id));
        historyId = added.historyId;
      } catch (cause) {
        if (!(cause instanceof GmailError && cause.status === 404)) throw cause;
        // The historyId expired (usually after a week offline). A full sync is
        // beyond this example: pick up from now.
        console.warn(`[gmail] history for ${options.email} expired; resuming from now`);
        historyId = await start();
      }
    }).catch((cause) => console.warn(`[gmail] sync for ${options.email} failed:`, cause instanceof Error ? cause.message : cause));
  };
  const stop = onMailbox(options.email, sync);
  const renew = setInterval(() => {
    void start().catch((cause) => console.warn(`[gmail] renewing the watch for ${options.email} failed:`, cause));
  }, DAY);
  try {
    await options.ready();
    await new Promise<void>((resolve) => {
      if (options.signal.aborted) return resolve();
      options.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  } finally {
    stop();
    clearInterval(renew);
  }
}

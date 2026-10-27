import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { after } from "next/server";
import { foundry } from "./foundry";

// The server half of the demo connectors (see ../demo-env.mjs): signing a
// mock's webhooks the way the provider does, checking the token the app
// sends to a mock's API, sending to the app's own webhook routes, and a log
// of everything that crossed the wire, which the demo page shows.

/** True when DEMO_CONNECTORS=1: the mocks are on, and the apps talk to them instead of the providers. */
export function demoConnectors(): boolean {
  return process.env.DEMO_CONNECTORS === "1";
}

/** HMAC-SHA256 of the body as `sha256=<hex>`: Meta's X-Hub-Signature-256, and the mock mail's. */
export function hubSignature(body: string | Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Slack's v0 signature, over `v0:<timestamp>:<body>`. */
export function slackSignature(body: string, timestamp: string, secret: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

/** Compare a signature header with the expected one in constant time. */
export function sameSignature(given: string, expected: string): boolean {
  const [a, b] = [Buffer.from(given), Buffer.from(expected)];
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Whether a request to a mock's API carries the token the app was given for it. */
export function bearer(request: Request, token: string | undefined): boolean {
  return Boolean(token) && sameSignature(request.headers.get("authorization") ?? "", `Bearer ${token}`);
}

/**
 * One thing that crossed the wire: `in` is a mock sending to the app (a
 * webhook), `out` the app calling a mock's API (a send), `hop` what the app
 * did with an inbound event (forwarded it to Foundry, which started runs).
 */
export interface MockEntry {
  readonly id: string;
  readonly at: string;
  readonly connector: string;
  readonly direction: "in" | "out" | "hop";
  /** The person the entry belongs to, for the demo page's workspace check. */
  readonly person?: string;
  readonly [key: string]: unknown;
}

export interface MockLog {
  append(entry: Omit<MockEntry, "id" | "at"> & Record<string, unknown>): Promise<MockEntry>;
  /** Oldest first, the last `limit` entries that pass `keep`. */
  list(keep?: (entry: MockEntry) => boolean, limit?: number): Promise<ReadonlyArray<MockEntry>>;
}

/** The demo connectors' log, one JSON line per entry, in `dir` (the app's data directory). */
export function mockLog(dir: string): MockLog {
  const file = join(dir, "demo-connectors.jsonl");
  return {
    async append(entry) {
      const line = { id: randomUUID(), at: new Date().toISOString(), ...entry } as MockEntry;
      await mkdir(dir, { recursive: true });
      await appendFile(file, `${JSON.stringify(line)}\n`);
      return line;
    },
    async list(keep = () => true, limit = 200) {
      const text = await readFile(file, "utf8").catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return "";
        throw cause;
      });
      const entries: MockEntry[] = [];
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as MockEntry;
          if (keep(entry)) entries.push(entry);
        } catch {
          // A line cut short by a crash; skip it.
        }
      }
      return entries.slice(-limit);
    },
  };
}

/**
 * POST to one of this app's own routes the way a provider would: at its
 * public address (WEB_URL), through the same edge a real webhook comes in
 * by. Without WEB_URL, on loopback.
 */
export async function postToOwnWebhook(path: string, body: string, headers: Record<string, string>): Promise<{ readonly url: string; readonly status: number; readonly text: string }> {
  const base = (process.env.WEB_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`).replace(/\/$/, "");
  const url = `${base}${path}`;
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  return { url, status: response.status, text: (await response.text()).slice(0, 500) };
}

/** What the mock mail route needs from the app: where its data is, how mail lands in a sample mailbox, and each account's inbound route. */
export interface MockMailHost {
  readonly dataDir: string;
  arrive(dataDir: string, email: string, message: MockMailMessage & { readonly labels: ReadonlyArray<string> }): Promise<void>;
  inboundRoute(accountId: string): { readonly id: string; readonly config: Readonly<Record<string, unknown>> };
}

export interface MockMailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly from: string;
  readonly subject: string;
  readonly body: string;
  readonly receivedAt: string;
}

interface MockMail {
  readonly person: string;
  readonly account: string;
  readonly email: string;
  readonly message: MockMailMessage;
}

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

function parseMail(body: string): MockMail | undefined {
  const value = JSON.parse(body) as Partial<MockMail>;
  const message = value.message;
  if (!isText(value.person, 64) || !isText(value.account, 128) || !isText(value.email, 320) || !message) return undefined;
  const ok = isText(message.id, 64) && isText(message.threadId, 64) && isText(message.from, 320)
    && isText(message.subject, 300) && isText(message.body, 5000) && isText(message.receivedAt, 40);
  return ok ? value as MockMail : undefined;
}

/**
 * The POST handler for /webhooks/mail: new mail for a sample account, from
 * the demo page's mock mail. Real Gmail calls no webhook (the Gmail watch
 * pulls Google's Pub/Sub subscription inside the unit), so this exists only
 * with DEMO_CONNECTORS=1 and takes only mail signed with MOCK_MAIL_SECRET. It
 * does for a sample account what the watch does for a real one: the message
 * lands in the mailbox, and the account's inbound route fires. What Foundry
 * did with it, and which agents it woke, goes in the log.
 */
export function mockMailWebhook(load: () => Promise<MockMailHost>): (request: Request) => Promise<Response> {
  return async (request) => {
    const secret = process.env.MOCK_MAIL_SECRET;
    if (!demoConnectors() || !secret) return new Response(null, { status: 404 });
    const body = await request.text();
    if (!sameSignature(request.headers.get("x-demo-signature") ?? "", hubSignature(body, secret))) return new Response(null, { status: 401 });
    const mail = parseMail(body);
    if (!mail) return new Response(null, { status: 400 });
    after(async () => {
      const app = await load();
      const { message } = mail;
      await app.arrive(app.dataDir, mail.email, { ...message, labels: ["INBOX"] });
      const route = app.inboundRoute(mail.account);
      const conversation = typeof route.config.conversation === "string" ? route.config.conversation : undefined;
      let status = 202;
      let runIds: string[] = [];
      let agentIds: string[] = [];
      try {
        const runs = await foundry().dispatchInbound({
          routeId: route.id,
          eventId: message.id,
          threadKey: message.threadId,
          ...(conversation ? { conversationKey: conversation, conversationScope: "agent" as const } : {}),
          raw: {
            messageId: message.id,
            threadId: message.threadId,
            from: message.from,
            subject: message.subject,
            snippet: message.body.slice(0, 200),
            receivedAt: message.receivedAt,
            rfcMessageId: `<${message.id}@mock.mail>`,
          },
        });
        runIds = runs.map((run) => run.id);
        agentIds = runs.flatMap((run) => (run.agentId ? [run.agentId] : []));
      } catch (cause) {
        status = 500;
        console.error(cause);
      }
      await mockLog(app.dataDir).append({ connector: "mail", direction: "hop", person: mail.person, eventId: message.id, route: route.id, status, runIds, agentIds });
    });
    return new Response(null, { status: 200 });
  };
}


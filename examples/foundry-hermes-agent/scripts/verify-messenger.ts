import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFoundryClient } from "glove-foundry/client";
import { FoundryRuntime, FoundryServer } from "glove-foundry";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = await mkdtemp(resolve(tmpdir(), "foundry-hermes-messenger-"));
const token = "test-bot-token";
const updateId = 9301;
const chatId = -1004244;
const sentMessages: Array<{ chat_id: string | number; text: string }> = [];
let getMeCalls = 0;
let updateCalls = 0;

async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
}

function respond(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const telegram = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://telegram.test");
  const match = url.pathname.match(/^\/bot([^/]+)\/(getMe|getUpdates|sendMessage)$/);
  if (!match || decodeURIComponent(match[1]!) !== token) {
    response.writeHead(404);
    response.end();
    return;
  }
  const method = match[2]!;
  const body = await jsonBody(request);
  if (method === "getMe") {
    getMeCalls += 1;
    respond(response, { ok: true, result: { id: 42, is_bot: true, username: "hermes_test_bot" } });
    return;
  }
  if (method === "getUpdates") {
    updateCalls += 1;
    const offset = Number(body.offset ?? 0);
    if (offset <= updateId) {
      respond(response, {
        ok: true,
        result: [{
          update_id: updateId,
          message: {
            message_id: 71,
            from: { id: 7, username: "operator" },
            chat: { id: chatId, type: "private" },
            text: "Hermes, report messenger readiness.",
          },
        }],
      });
    } else {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      respond(response, { ok: true, result: [] });
    }
    return;
  }
  sentMessages.push(body as { chat_id: string | number; text: string });
  respond(response, {
    ok: true,
    result: {
      message_id: 72,
      chat: { id: chatId, type: "private" },
      text: body.text,
    },
  });
});

await new Promise<void>((resolveListen, reject) => {
  telegram.once("error", reject);
  telegram.listen(0, "127.0.0.1", () => {
    telegram.removeListener("error", reject);
    resolveListen();
  });
});
const telegramAddress = telegram.address() as AddressInfo;

process.env.HERMES_FORCE_DEMO = "1";
process.env.HERMES_DATA_DIR = dataDirectory;
process.env.HERMES_MESSENGER_PROVIDER = "telegram";
process.env.TELEGRAM_BOT_TOKEN = token;
process.env.TELEGRAM_API_BASE_URL = `http://127.0.0.1:${telegramAddress.port}`;
process.env.TELEGRAM_LONG_POLL_SECONDS = "1";

const [{ default: application }, { default: config }] = await Promise.all([
  import("../foundry.application.js"),
  import("../foundry.config.js"),
]);

const runtime = await FoundryRuntime.discover({
  rootDir,
  agentsDir: resolve(rootDir, "agents"),
  application,
  applicationFilePath: resolve(rootDir, "foundry.application.ts"),
  config,
});
const foundryServer = new FoundryServer(runtime, { host: "127.0.0.1", port: 0 });

await runtime.start();
try {
  const listening = await foundryServer.listen();
  const foundry = createFoundryClient({ baseUrl: listening.url });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && sentMessages.length === 0) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  assert.equal(sentMessages.length, 1, "Telegram inbound message did not produce an outbound reply.");
  assert.equal(String(sentMessages[0]?.chat_id), String(chatId));
  assert.match(sentMessages[0]?.text ?? "", /Hermes completed/i);
  assert.ok(getMeCalls >= 1);
  assert.ok(updateCalls >= 1);

  const connections = runtime.listApplicationConnections();
  assert.equal(connections.length, 1);
  assert.equal(connections[0]?.status, "connected");
  assert.equal(connections[0]?.accountId, application.accounts?.[0]?.id);
  assert.ok(connections[0]?.lastEventAt);

  const inboundRun = (await foundry.runs()).find((run) => {
    const input = run.input as { source?: { eventId?: string } } | undefined;
    return input?.source?.eventId === `telegram:${updateId}`;
  });
  assert.ok(inboundRun);
  const completedInbound = await runtime.waitForRun(inboundRun.id, { timeoutMs: 30_000 });
  assert.equal(completedInbound?.status, "completed", completedInbound?.error);
  const events = inboundRun ? await foundry.getEvents({ runId: inboundRun.id }) : [];
  assert.ok(events.some((event) => event.type === "transmission.outbound.delivered"));

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    provider: "telegram",
    connection: connections[0]?.status,
    inboundEvent: `telegram:${updateId}`,
    outboundMessageId: "72",
    credentialBoundary: "account-session-adapter",
  }, null, 2)}\n`);
} finally {
  await foundryServer.close();
  await runtime.stop();
  await new Promise<void>((resolveClose, reject) => telegram.close((cause) => cause ? reject(cause) : resolveClose()));
  await rm(dataDirectory, { recursive: true, force: true });
}

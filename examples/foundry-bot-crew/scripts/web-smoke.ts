import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

// The web app end to end, offline: Foundry and the web app run as one unit
// (scripts/start.mjs) with scripted models (CREW_DEMO=1), and a real browser
// drives it.
//   1. Maya opens her invite link and is signed in; the session cookie is HttpOnly.
//   2. She writes to Inbox Manager and its reply streams in.
//   3. She asks it to reply to Dan; the email waits in an approval card; she allows it once and it goes out.
//   4. Another person's bot, run and page answer 404; no session answers 401; a forged link signs no one in.
//   5. She signs out.
// Needs a build (`pnpm build`; run here if missing) and Chromium (CHROMIUM_PATH, default /opt/pw-browsers/chromium).

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromiumPath = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

if (!existsSync(join(root, ".next", "BUILD_ID"))) {
  assert.equal(spawnSync("pnpm", ["build"], { cwd: root, stdio: "inherit" }).status, 0, "next build");
}

const freePort = () => new Promise<number>((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as { port: number };
    server.close(() => resolvePort(port));
  });
});

async function until<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((wait) => setTimeout(wait, 250));
  }
}

const dataDir = await mkdtemp(join(tmpdir(), "bot-crew-web-"));
const [webPort, foundryPort] = [await freePort(), await freePort()];
const web = `http://127.0.0.1:${webPort}`;
const foundryUrl = `http://127.0.0.1:${foundryPort}`;
const token = randomBytes(24).toString("base64url");
const env = {
  ...process.env,
  CREW_DEMO: "1",
  CREW_DATA_DIR: dataDir,
  FOUNDRY_TOKEN: token,
  FOUNDRY_PORT: String(foundryPort),
  WEB_SESSION_SECRET: randomBytes(32).toString("base64url"),
  WEB_URL: web,
  PORT: String(webPort),
};

let log = "";
const unit = spawn(process.execPath, ["scripts/start.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
unit.stdout.on("data", (chunk) => { log += chunk; });
unit.stderr.on("data", (chunk) => { log += chunk; });
const asFoundry = (path: string, init: RequestInit = {}) =>
  fetch(`${foundryUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } });

const browser = await chromium.launch({ executablePath: chromiumPath });
try {
  await until(async () => (await fetch(`${web}/welcome`)).ok || undefined, "the web app");
  await until(async () => (await asFoundry("/health")).ok || undefined, "Foundry");

  // Someone else's bot, with a run, in another workspace.
  assert.equal((await asFoundry("/api/agent-instances", {
    method: "POST",
    body: JSON.stringify({ definitionId: "bot", id: "sam-bot-1", workspaceId: "sam", name: "Pip", description: "Sam's helper.", context: { owner: "Sam", routines: [] } }),
  })).status, 201);
  await asFoundry("/api/conversations", { method: "POST", body: JSON.stringify({ agentId: "sam-bot-1", id: "sam-bot-1-chat" }) });
  const samRun = await (await asFoundry("/api/conversations/sam-bot-1-chat/messages", { method: "POST", body: JSON.stringify({ agentId: "sam-bot-1", message: "Hi" }) })).json() as { id: string };

  // 1. The invite link, as `pnpm invite maya` prints it.
  const invite = spawnSync(process.execPath, ["--import", "tsx", "scripts/invite.ts", "maya"], { cwd: root, env, encoding: "utf8" }).stdout.trim();
  assert.match(invite, new RegExp(`^${web}/signin\\?t=maya\\.\\d+\\.[\\w-]+$`));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  // Keep every live event the page receives, to check what reached the browser.
  await page.addInitScript(() => {
    const Native = window.EventSource;
    const seen: string[] = [];
    (window as unknown as { __live: string[] }).__live = seen;
    window.EventSource = class extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("message", (event) => seen.push((event as MessageEvent<string>).data));
      }
    };
  });
  await page.goto(invite);
  assert.equal(new URL(page.url()).pathname, "/bots");
  const session = (await context.cookies()).find((cookie) => cookie.name === "session");
  assert.ok(session?.httpOnly && session.sameSite === "Lax", "an HttpOnly, SameSite=Lax session cookie");
  console.log("1. Maya opened her invite link and is signed in");

  // 2. A message, and the reply streaming in.
  await page.goto(`${web}/bots/maya-inbox`);
  const box = page.getByLabel("Message Inbox Manager");
  await box.fill("Hi, I'm Maya.");
  await box.press("Enter");
  await page.getByText("Hi Maya. I'm watching your inbox and will answer what I can from your address.").waitFor();
  const live = async () => (await page.evaluate(() => (window as unknown as { __live: string[] }).__live)).map((data) => JSON.parse(data) as { type: string } & Record<string, unknown>);
  const first = await until(async () => {
    const events = await live();
    return events.some((event) => event.type === "run.completed") ? events : undefined;
  }, "the run to end");
  const deltas = first.filter((event) => event.type === "agent.text_delta");
  assert.ok(deltas.length > 3, `the reply streamed in pieces (${deltas.length})`);
  console.log(`2. Inbox Manager's reply streamed in, ${deltas.length} pieces`);

  // 3. An email waits for her approval; "Always allow" isn't offered for sending.
  await box.fill("Reply to Dan: Friday at 10 works.");
  await page.getByRole("button", { name: "Send" }).click();
  const card = page.getByRole("group", { name: "Approval" });
  await card.waitFor();
  const shown = await card.innerText();
  assert.match(shown, /Inbox Manager wants to send this email/);
  assert.match(shown, /dan@contoso\.example/);
  assert.match(shown, /Would Friday at 10 work instead\?/);
  assert.equal(await card.getByRole("button", { name: "Always allow" }).count(), 0, "sending email always asks");
  await card.getByRole("button", { name: "Allow once" }).click();
  await page.getByText("Sent your reply to Dan.").waitFor();
  const ledger = await readFile(join(dataDir, "ledger.jsonl"), "utf8");
  assert.match(ledger, /"to":"dan@contoso\.example"/, "the email went out from her sample Gmail");
  console.log("3. the reply to Dan waited in an approval card; allowed once, it went out");

  // Only whitelisted events, with only their listed fields, reached the browser.
  const allowed: Record<string, ReadonlyArray<string>> = {
    "agent.text_delta": ["text"],
    "agent.tool_use": ["name", "label", "chip"],
    "agent.tool_use_result": ["name", "status"],
    "agent.foundry.approval.requested": ["approvalId", "toolName"],
    "approval.resolved": ["approvalId", "status"],
    "run.started": [], "run.completed": [], "run.failed": [], "run.cancelled": [],
  };
  for (const event of await live()) {
    const { seq: _seq, type, ...fields } = event;
    assert.ok(allowed[type], `unexpected live event ${type}`);
    for (const field of Object.keys(fields)) assert.ok(allowed[type]!.includes(field), `${type} carried ${field}`);
  }
  assert.doesNotMatch(await page.content(), new RegExp(token), "no Foundry token in the page");

  // 4. Another workspace's records are not found; no session is not allowed; a forged link signs no one in.
  assert.equal((await page.request.get(`${web}/api/bots/sam-bot-1/chat`)).status(), 404);
  assert.equal((await page.request.post(`${web}/api/bots/sam-bot-1/chat`, { data: { text: "hi" } })).status(), 404);
  assert.equal((await page.request.get(`${web}/api/runs/${samRun.id}/live`)).status(), 404);
  assert.equal((await page.goto(`${web}/bots/sam-bot-1`))?.status(), 404);
  assert.equal((await fetch(`${web}/api/bots/maya-inbox/chat`)).status, 401);
  const forged = await fetch(`${web}/signin?t=${invite.split("t=")[1]!.replace(/^maya/, "sam")}`, { redirect: "manual" });
  assert.equal(forged.headers.get("location"), "/welcome?link=expired");
  assert.equal(forged.headers.get("set-cookie"), null);
  console.log("4. Sam's bot, run and page answer 404 to Maya; no session gets 401; a forged link signs no one in");

  // 5. Signing out.
  await page.goto(`${web}/bots`);
  await page.getByLabel("Signed in as Maya").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(`${web}/welcome`);
  await page.goto(`${web}/bots`);
  assert.equal(new URL(page.url()).pathname, "/welcome");
  console.log("5. she signed out");

  console.log("\nWeb app verified: invite sign-in, a streamed reply, an approval, workspace checks, sign-out.");
} catch (error) {
  console.error(log.split("\n").slice(-60).join("\n"));
  throw error;
} finally {
  await browser.close();
  unit.kill("SIGTERM");
  await new Promise((done) => unit.exitCode !== null ? done(undefined) : unit.once("exit", done));
  await rm(dataDir, { recursive: true, force: true });
}

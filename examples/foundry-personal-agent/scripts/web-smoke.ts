import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";

// The web app end to end, offline: Foundry and the web app run as one unit
// (scripts/start.mjs) with the scripted model (MUSE_DEMO=1), Kuiper's browser
// API stood in for by demo/kuiper.ts, and a real browser drives the app.
//   1. Rosa opens her invite link and is signed in; the session cookie is HttpOnly.
//   2. She says hi and Muse's reply streams in.
//   3. She asks it to book Bistro Luna. The Sentinel's question shows as its card (send, not read); she allows it.
//   4. The site wants her signed in: Watch offers "Take over to sign in", which redirects her alone to the
//      interactive live view. No page holds that link. She signs in there; Muse books; the hand-off is gone.
//   5. She tells it to remember something, then forgets it from You; renames it; gives Gmail send access.
//   6. She gives it a goal and a fare to watch. Plans shows the plan and the log; Connections shows the site she allowed.
//   7. Another person's run, approval and memory answer 404; no session answers 401; a forged link signs no one in.
//   8. She signs out.
// Needs a build (`pnpm build`; run here if missing) and Chromium (MUSE_CHROMIUM, default /opt/pw-browsers/chromium).
// WEB_SMOKE_SHOTS=<dir> also saves each screen at 390×844 and 1440×900.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.env.MUSE_CHROMIUM ??= "/opt/pw-browsers/chromium";
const chromiumPath = process.env.MUSE_CHROMIUM;
const shots = process.env.WEB_SMOKE_SHOTS;

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

// Kuiper's browser API, on this machine: each session is a local Chromium browsing sample sites.
const { ROSA_BISTRO_PASSWORD, startOfflineKuiper } = await import("../demo/kuiper.js");
const kuiperHere = await startOfflineKuiper();

const dataDir = await mkdtemp(join(tmpdir(), "muse-web-"));
const [webPort, foundryPort] = [await freePort(), await freePort()];
const web = `http://127.0.0.1:${webPort}`;
const foundryUrl = `http://127.0.0.1:${foundryPort}`;
const token = randomBytes(24).toString("base64url");
const env = {
  ...process.env,
  MUSE_DEMO: "1",
  MUSE_DATA_DIR: dataDir,
  BROWSERS_URL: kuiperHere.url,
  KUIPER_GATEWAY_KEY: kuiperHere.key,
  FOUNDRY_TOKEN: token,
  FOUNDRY_PORT: String(foundryPort),
  WEB_SESSION_SECRET: randomBytes(32).toString("base64url"),
  WEB_URL: web,
  PORT: String(webPort),
};
delete (env as Record<string, string | undefined>).WHATSAPP_TOKEN;

let log = "";
const unit = spawn(process.execPath, ["scripts/start.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
unit.stdout.on("data", (chunk) => { log += chunk; });
unit.stderr.on("data", (chunk) => { log += chunk; });
const asFoundry = (path: string, init: RequestInit = {}) =>
  fetch(`${foundryUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } });
const instance = async (id: string) =>
  ((await (await asFoundry("/api/agent-instances?definition=muse")).json()) as Array<{ id: string; name?: string; context: Record<string, unknown>; installations: Array<{ id: string; config?: { access?: string } }> }>)
    .find((agent) => agent.id === id)!;
const runOf = async (id: string) => (await (await asFoundry(`/api/runs/${id}`)).json()) as { status: string };

async function shoot(page: Page, name: string) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  for (const [label, viewport] of [["390", { width: 390, height: 844 }], ["1440", { width: 1440, height: 900 }]] as const) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(shots, `muse-${name}-${label}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

const browser = await chromium.launch({ executablePath: chromiumPath });
let current: Page | undefined;
try {
  await until(async () => (await fetch(`${web}/welcome`)).ok || undefined, "the web app");
  await until(async () => (await asFoundry("/health")).ok || undefined, "Foundry");

  // Someone else: Sam's Muse in his own workspace, with a run and something it remembers.
  assert.equal((await asFoundry("/api/agent-instances", {
    method: "POST",
    body: JSON.stringify({ definitionId: "muse", id: "sam-muse", workspaceId: "sam", name: "Juniper", description: "Sam's personal agent", context: { name: "Sam", persona: {}, sentinel: { read: [], write: [], blocked: [] } } }),
  })).status, 201);
  await asFoundry("/api/conversations", { method: "POST", body: JSON.stringify({ agentId: "sam-muse", id: "sam-muse-app", context: { conversationKey: "app" } }) });
  const samRun = await (await asFoundry("/api/conversations/sam-muse-app/messages", { method: "POST", body: JSON.stringify({ agentId: "sam-muse", message: "Remember that Priya is vegetarian." }) })).json() as { id: string };
  await until(async () => (await runOf(samRun.id)).status === "completed" || undefined, "Sam's run");
  const samTranscript = await (await asFoundry("/api/conversations/sam-muse-app/messages?agent=sam-muse")).json() as { messages: Array<{ tool_results?: Array<{ result: { data?: { id?: string } } }> }> };
  const samMemory = samTranscript.messages.flatMap((message) => message.tool_results ?? []).map((result) => result.result.data?.id).find(Boolean);
  assert.ok(samMemory, "Sam's Muse remembers something");

  // 1. The invite link, as `pnpm invite rosa` prints it.
  const invite = spawnSync(process.execPath, ["--import", "tsx", "scripts/invite.ts", "rosa"], { cwd: root, env, encoding: "utf8" }).stdout.trim();
  assert.match(invite, new RegExp(`^${web}/signin\\?t=rosa\\.\\d+\\.[\\w-]+$`));
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  current = page;
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
  assert.equal(new URL(page.url()).pathname, "/chat");
  const session = (await context.cookies()).find((cookie) => cookie.name === "session");
  assert.ok(session?.httpOnly && session.sameSite === "Lax", "an HttpOnly, SameSite=Lax session cookie");
  console.log("1. Rosa opened her invite link and is signed in");

  // A message from the composer, once it takes one (it waits while a reply streams in).
  const say = async (text: string) => {
    const box = page.getByLabel(/^Message /);
    await box.fill(text);
    await until(async () => (await page.getByRole("button", { name: "Send" }).isEnabled()) || undefined, "the composer");
    await box.press("Enter");
  };

  // 2. A message, and the reply streaming in.
  await say("Hi, I'm Rosa.");
  await page.getByText("Hi Rosa, I'm Muse. Tell me what you want done, here or on WhatsApp.").waitFor();
  const live = async () => (await page.evaluate(() => (window as unknown as { __live: string[] }).__live)).map((data) => JSON.parse(data) as { type: string } & Record<string, unknown>);
  const first = await until(async () => {
    const events = await live();
    return events.some((event) => event.type === "run.completed") ? events : undefined;
  }, "the run to end");
  const deltas = first.filter((event) => event.type === "agent.text_delta");
  assert.ok(deltas.length > 3, `the reply streamed in pieces (${deltas.length})`);
  console.log(`2. Muse's reply streamed in, ${deltas.length} pieces`);

  // 3. A booking: the Sentinel asks about sending to the site; she allows it.
  await say("Book Bistro Luna for the four of us on Friday at 7.");
  const card = page.getByRole("group", { name: "The Sentinel asks" });
  await card.waitFor();
  const shown = await card.innerText();
  assert.match(shown, /Muse wants to send to bistro-luna\.example: book a table for 4 on Friday at 19:00\./);
  assert.match(shown, /Sending is a separate yes/);
  await shoot(page, "chat");
  await card.getByRole("button", { name: "Allow sending here" }).click();
  await page.getByText("Bistro Luna wants you signed in to book. I've sent you a link to my browser").waitFor();
  const instanceAfterAsk = await instance("rosa-muse");
  assert.deepEqual((instanceAfterAsk.context.sentinel as { write: string[] }).write, ["bistro-luna.example"], "her yes added the site, for sending");
  const booking = await live();
  assert.ok(booking.some((event) => event.type === "agent.foundry.approval.requested" && event.toolName === "request_access"));
  console.log("3. the Sentinel's question showed as its card; she allowed sending to bistro-luna.example");

  // 4. The hand-off: Watch offers to take over; only a redirect for her carries the private link.
  await page.getByRole("link", { name: "Open the sign-in" }).click();
  await page.waitForURL(`${web}/watch`);
  const turn = page.getByRole("group", { name: "Your turn" });
  await turn.waitFor();
  assert.match(await turn.innerText(), /bistro-luna\.example wants you signed in/);
  const { sessionId, profileId } = instanceAfterAsk.context.browser as { sessionId: string; profileId?: string };
  for (const path of ["/watch", "/chat", "/api/watch", "/api/chat"]) {
    const body = await (await page.request.get(`${web}${path}`)).text();
    assert.doesNotMatch(body, /token=/, `${path} doesn't hold the interactive live view`);
    assert.ok(!body.includes(sessionId) && !(profileId && body.includes(profileId)), `${path} doesn't name the Kuiper session or profile`);
  }
  await shoot(page, "watch");
  const redirect = await page.request.get(`${web}/api/watch/take-over`, { maxRedirects: 0 });
  assert.equal(redirect.status(), 303);
  assert.match(redirect.headers().location ?? "", new RegExp(`/browsers/live/${sessionId}\\?token=`), "Take over redirects her to the interactive live view");
  const [liveView] = await Promise.all([context.waitForEvent("page"), turn.getByRole("link", { name: "Take over to sign in" }).click()]);
  await liveView.waitForURL(/\/browsers\/live\/.*\?token=/);
  await liveView.close();
  await kuiperHere.asPerson(sessionId, async (person) => {
    await person.getByLabel("Email").fill("rosa@example.com");
    await person.getByLabel("Password").fill(ROSA_BISTRO_PASSWORD);
    await person.getByRole("button", { name: "Sign in" }).click();
    await person.waitForURL(/\/reserve$/);
  });
  await page.getByRole("link", { name: "Chat" }).click();
  await say("Done, I'm signed in.");
  await page.getByText(/^Booked Bistro Luna for 4 on Friday at 7/).waitFor();
  await until(async () => (await page.request.get(`${web}/api/watch/take-over`, { maxRedirects: 0 })).status() === 404 || undefined, "the hand-off to clear");
  assert.doesNotMatch(JSON.stringify(await (await page.request.get(`${web}/api/watch`)).json()), /wants you|token=/);
  console.log("4. Watch offered Take over, a redirect to the live view for her alone; she signed in, Muse booked, and the hand-off cleared with the session");

  // 5. Remember, then forget from You; a new name; Gmail send access.
  await say("Priya is vegetarian, remember that for dinners.");
  await page.getByText("Noted: Priya is vegetarian. I'll plan around it.").waitFor();
  await page.getByRole("link", { name: "You" }).click();
  await page.waitForURL(`${web}/you`);
  const forgetPriya = page.getByRole("button", { name: "Forget: Priya is vegetarian." });
  await forgetPriya.waitFor();
  await shoot(page, "you");
  await forgetPriya.click();
  await forgetPriya.waitFor({ state: "detached" });
  const name = page.getByLabel("Name", { exact: true });
  await name.fill("Wren");
  await name.press("Enter");
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  const renamed = await instance("rosa-muse");
  assert.equal(renamed.name, "Wren");
  assert.deepEqual((renamed.context.sentinel as { write: string[] }).write, ["bistro-luna.example"], "the rename kept the rest of its data");
  assert.equal((renamed.context.persona as { style?: string }).style, "Warm and brief, like a text from a friend. No exclamation marks.");
  await page.getByRole("link", { name: "Chat" }).click();
  await page.getByRole("heading", { name: "Wren" }).waitFor();
  await say("Who's vegetarian?");
  await page.getByText("I don't know of anyone vegetarian.").waitFor();
  await say("Help me get ready for the half marathon on 6 December.");
  await page.getByText(/^Here's the plan: register/).waitFor();
  await say("Watch the train fare to Boston on the 14th and tell me when it's under $60.");
  await page.getByText(/^I'll check the fare every 6 hours/).waitFor();
  console.log("5. she forgot Priya from You (Muse no longer knows), and renamed it Wren, keeping its style and the Sentinel's lists");

  // 6. Connections and Plans.
  await page.goto(`${web}/you/connections`);
  const sites = await page.getByRole("region", { name: "Sites the Sentinel knows" }).innerText();
  assert.match(sites, /bistro-luna\.example\s*Read · Send/);
  const gmail = page.getByRole("group", { name: "Gmail access" });
  assert.equal(await gmail.getByRole("button", { name: "Read" }).getAttribute("aria-pressed"), "true");
  await gmail.getByRole("button", { name: "Act" }).click();
  await until(async () => (await gmail.getByRole("button", { name: "Act" }).getAttribute("aria-pressed")) === "true" || undefined, "Act");
  const gmailInstall = (await instance("rosa-muse")).installations.find((item) => item.id === "gmail");
  assert.equal(gmailInstall?.config?.access, "act", "Gmail send access is on the installation");
  await shoot(page, "connections");
  await page.goto(`${web}/plans`);
  const plans = await page.locator("main").innerText();
  assert.match(plans, /The Sentinel blocked collect\.example/);
  assert.match(plans, /You allowed sending to bistro-luna\.example/);
  assert.match(plans, /A suggestion each day, if one would help/);
  assert.match(plans, /Half marathon on 6 December\s*0 of 4/);
  assert.match(plans, /Next plan step: Register for the race/);
  assert.match(plans, /Check the train fare to Boston for the 14th, every 6 hours/);
  await shoot(page, "plans");
  console.log("6. Connections shows the site she allowed and Gmail at Act; Plans shows her plan, the fare watch and the log");

  // Only whitelisted events, with only their listed fields, reached the browser; no Foundry token in a page.
  const allowed: Record<string, ReadonlyArray<string>> = {
    "agent.text_delta": ["text"],
    "agent.tool_use": ["name", "label", "chip"],
    "agent.tool_use_result": ["name", "status"],
    "agent.foundry.approval.requested": ["approvalId", "toolName"],
    "approval.resolved": ["approvalId", "status"],
    "run.started": [], "run.completed": [], "run.failed": [], "run.cancelled": [],
  };
  await page.goto(`${web}/chat`);
  for (const event of [...first, ...booking]) {
    const { seq: _seq, type, ...fields } = event;
    assert.ok(allowed[type], `unexpected live event ${type}`);
    for (const field of Object.keys(fields)) assert.ok(allowed[type]!.includes(field), `${type} carried ${field}`);
  }
  assert.doesNotMatch(await page.content(), new RegExp(token), "no Foundry token in the page");

  // 7. Another workspace's records are not found; no session is not allowed; a forged link signs no one in.
  assert.equal((await page.request.get(`${web}/api/runs/${samRun.id}/live`)).status(), 404);
  assert.equal((await page.request.post(`${web}/api/approvals/sam-approval`, { data: { decision: "approve" } })).status(), 404);
  assert.equal((await page.request.delete(`${web}/api/memory/${samMemory}`)).status(), 404);
  assert.equal((await fetch(`${web}/api/chat`)).status, 401);
  assert.equal((await fetch(`${web}/api/watch/take-over`, { redirect: "manual" })).status, 401);
  const forged = await fetch(`${web}/signin?t=${invite.split("t=")[1]!.replace(/^rosa/, "sam")}`, { redirect: "manual" });
  assert.equal(forged.headers.get("location"), "/welcome?link=expired");
  assert.equal(forged.headers.get("set-cookie"), null);
  console.log("7. Sam's run, an approval and Sam's memory answer 404 to Rosa; no session gets 401; a forged link signs no one in");

  // 8. Signing out.
  await page.goto(`${web}/you`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(`${web}/welcome`);
  await shoot(page, "welcome");
  await page.goto(`${web}/chat`);
  assert.equal(new URL(page.url()).pathname, "/welcome");
  console.log("8. she signed out");

  console.log("\nWeb app verified: invite sign-in, a streamed reply, the Sentinel's card, a hand-off taken over from Watch, Forget, the persona, access, the log, workspace checks, sign-out.");
} catch (error) {
  console.error(log.split("\n").slice(-60).join("\n"));
  if (current) console.error(`\nThe page (${current.url()}):\n${await current.locator("body").innerText().catch(() => "")}`);
  if (process.env.WEB_SMOKE_DEBUG) console.error(await readFile(join(dataDir, "activity.jsonl"), "utf8").catch(() => ""));
  throw error;
} finally {
  await browser.close();
  try {
    process.kill(-unit.pid!, "SIGTERM");
  } catch {
    // Already gone.
  }
  await new Promise((done) => unit.exitCode !== null ? done(undefined) : unit.once("exit", done));
  await kuiperHere.close();
  await rm(dataDir, { recursive: true, force: true });
}

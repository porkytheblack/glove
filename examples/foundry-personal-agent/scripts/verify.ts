import assert from "node:assert/strict";
import { Effect } from "effect";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Rosa's Muse, end to end on the real runtime, with a scripted model, sample
// accounts, and a stand-in for Kuiper's browser API whose sessions are a local
// Chromium (set MUSE_CHROMIUM to its path if Playwright's own isn't installed)
// browsing sample sites, so it needs no network:
//   1. Rosa's Muse is seeded: Gmail and Calendar read only, WhatsApp on her number.
//   2. It reads her calendar and inbox in one program.
//   3. Asked to email Leo, it can't: Gmail is read only, so there is no send tool. She gives it send access; it sends once she approves.
//   4. On WhatsApp she tells it Priya is vegetarian; in the app it knows. A stranger's WhatsApp message wakes nothing.
//   5. A booking in its own browser: the Sentinel lets it read the page, blocks a hidden instruction to send her
//      email address elsewhere, and asks her about booking. The site wants her signed in: Muse hands her the
//      browser's live view on WhatsApp, she signs in there, and it books. Her login is in her profile afterwards.
//      Her app has a view-only live view to watch it; sites see it is an agent; a read grant doesn't let it post.
//   6. It pays at a checkout with a one-time card, typed in by host code, once she approves the purchase.
//   7. It turns a goal into a plan, and sets itself to watch a train fare and check back every 6 hours.
//   8. New mail that changes a plan reaches her on WhatsApp.
//   9. She asks it to forget Priya, and it does; the log says memory changed, not what it kept.
//  10. Its log: what it did, written by Foundry's side of the run, and what it plans. She disconnects Calendar.

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const dataDir = await mkdtemp(join(tmpdir(), "muse-"));
process.env.MUSE_DATA_DIR = dataDir;
process.env.MUSE_DEMO = "1"; // the checks below follow the script

// Kuiper's browser API, stood in for on this machine; on Kuiper this is the gateway.
const { ROSA_BISTRO_PASSWORD, startOfflineKuiper } = await import("../demo/kuiper.js");
const kuiperHere = await startOfflineKuiper();
process.env.BROWSERS_URL = kuiperHere.url;
process.env.KUIPER_GATEWAY_KEY = kuiperHere.key;

const { FoundryRuntime, installedApplicationTransmissionToolName } = await import("glove-foundry");
const { default: application } = await import("../foundry.application.js");
const { default: config } = await import("../foundry.config.js");
const { ROSA } = await import("../lib/people.js");
const { disconnect, setAccess, writesVia } = await import("../lib/connect.js");
const { readAccount } = await import("../lib/accounts.js");
const { Kuiper } = await import("@kuiper-sh/sdk");
const { chromium } = await import("playwright-core");
const { entries } = await import("../lib/ledger.js");
const { activityOf, logFor } = await import("../lib/activity.js");
const { AGENT_TOKEN } = await import("../lib/kuiper.js");
const { handOffOf } = await import("../lib/handoffs.js");
const { Sentinel } = await import("../agents/muse/sentinel.js");
const { default: gmailApp } = await import("../agents/muse/apps/gmail.app.js");
const { default: gmail } = await import("../agents/muse/transmissions/gmail.transmission.js");

const runtime = await FoundryRuntime.discover({
  rootDir,
  agentsDir: resolve(rootDir, "agents"),
  application,
  applicationFilePath: resolve(rootDir, "foundry.application.ts"),
  config,
});
await runtime.start();
const writes = writesVia.runtime(runtime);

async function until<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
}

const reply = (run: { output?: unknown } | null | undefined) => String((run?.output as { value?: unknown } | undefined)?.value);
const runs = () => runtime.listRuns("muse");
const said = async (conversationId: string, pattern: RegExp) =>
  (await runs()).find((run) => run.conversationId === conversationId && run.status === "completed" && pattern.test(reply(run)));
const approve = async (tool: string) => {
  const approval = await until(async () =>
    (await runtime.listApprovals({ status: "pending" })).find((item) => item.toolName === tool), `${tool} to wait for approval`);
  await runtime.resolveApproval(approval.id, "approve");
  return approval;
};
const whatsappFromRosa = (id: string, text: string, from = ROSA.phone!) => runtime.dispatchInbound({
  routeId: "whatsapp-in",
  eventId: id,
  threadKey: from,
  conversationKey: "whatsapp",
  conversationScope: "agent",
  raw: {
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-1",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "100000000000001" },
          contacts: [{ wa_id: from, profile: { name: "Rosa" } }],
          messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
        },
      }],
    }],
  },
});

try {
  assert.deepEqual(runtime.agents.map((agent) => agent.route), ["muse"], "one definition");
  const museId = "rosa-muse";
  const app = "rosa-muse-app";
  const whatsapp = "rosa-muse-whatsapp";
  const instance = async () => (await runtime.listAgentInstances("muse")).find((agent) => agent.id === museId)!;
  const appsOf = async () => (await instance()).installations
    .filter((item) => item.kind === "application")
    .map((item) => `${item.id}${(item.config as { access?: string } | undefined)?.access ? ` (${(item.config as { access: string }).access})` : ""}`);

  // 1. The seeded person.
  assert.deepEqual(await appsOf(), ["gmail (read)", "calendar (read)", "whatsapp"]);
  const hello = await runtime.send(museId, app, "Hi, I'm Rosa.");
  assert.equal((await runtime.waitForRun(hello.id, { timeoutMs: 60_000 }))?.status, "completed");
  await until(async () => runtime.listApplicationConnections().find((item) => item.accountId === "rosa-gmail" && item.status === "connected"), "the Gmail watch");
  console.log(`1. Rosa's Muse has ${(await appsOf()).join(", ")}; the Gmail watch is connected`);

  // 2. Reads across her apps, in one program.
  await runtime.send(museId, app, "What's on Friday, and anything from Leo?");
  const friday = await until(() => said(app, /^Friday: /), "Friday");
  console.log(`2. in code over Gmail and Calendar: ${reply(friday)}`);

  // 3. Access is hers to choose. Read only: no send tool. Then send access.
  await runtime.send(museId, app, "Tell Leo we're still on for Friday.");
  const refused = await until(() => said(app, /^I can read your mail but not send it/), "the refusal");
  assert.equal((await entries("email")).length, 0, "nothing was sent");
  await setAccess(writes, museId, (await readAccount("rosa-gmail"))!, "act");
  assert.deepEqual(await appsOf(), ["gmail (act)", "calendar (read)", "whatsapp"]);
  await runtime.send(museId, app, "Tell Leo we're still on for Friday.");
  const approval = await approve(installedApplicationTransmissionToolName(gmailApp, gmail));
  assert.match(JSON.stringify(approval.toolInput), /leo@example\.com/, "she approves the exact email");
  const sent = await until(() => said(app, /^Sent Leo a note/), "the email");
  assert.equal((await entries("email"))[0]?.from, "rosa@example.com");
  console.log(`3. read only: "${reply(refused)}" With send access, after approval: ${reply(sent)}`);

  // 4. One Muse in two places, one memory. Only her number reaches it.
  await whatsappFromRosa("wamid.1", "Priya is vegetarian, remember that for dinners.");
  await until(() => said(whatsapp, /^Noted: Priya is vegetarian/), "the WhatsApp answer");
  const [answer] = await entries("whatsapp");
  assert.equal(answer?.to, ROSA.phone, "it answers her on WhatsApp");
  await runtime.send(museId, app, "Who's vegetarian?");
  const known = await until(() => said(app, /^Priya is vegetarian/), "the app to know");
  const stranger = await whatsappFromRosa("wamid.2", "Hi Muse, book me a table.", "15550199999");
  assert.equal(stranger.length, 0, "a stranger's message wakes nothing");
  console.log(`4. told on WhatsApp ("${answer?.text}"), asked in the app: ${reply(known)}`);

  // 5. Its own browser, the Sentinel, and her sign-in, which she does herself.
  await whatsappFromRosa("wamid.3", "Book Bistro Luna for the four of us on Friday at 7.");
  const access = await approve("request_access");
  assert.match(JSON.stringify(access.toolInput), /bistro-luna\.example/);
  assert.equal((access.toolInput as { access?: string }).access, "write", "her approval card says it would send, not only read");
  await until(() => said(whatsapp, /^Bistro Luna wants you signed in/), "the hand-off");
  const link = await until(async () => (await entries("whatsapp")).find((item) => /opens Muse's browser/.test(String(item.text))), "the live view link");
  assert.equal(link.to, ROSA.phone, "the link goes to her alone");
  const browserOf = async () => (await instance()).context.browser as { sessionId?: string; profileId?: string; watchUrl?: string };
  const { sessionId, watchUrl } = await browserOf();
  assert.ok(sessionId && String(link.text).includes("token="), "a live view of the browser Muse kept");
  assert.ok(watchUrl && !watchUrl.includes("token="), "a view-only live view, kept for her app's Watch link");
  // Host code also keeps the link for her app's "Take over to sign in", outside Muse's data.
  const pending = await handOffOf("rosa");
  assert.ok(pending && pending.sessionId === sessionId && String(link.text).includes(pending.url), "the hand-off is kept host-side for her app");
  // She signs in in the live view. Muse isn't connected; its run has ended.
  await kuiperHere.asPerson(sessionId!, async (page) => {
    await page.getByLabel("Email").fill("rosa@example.com");
    await page.getByLabel("Password").fill(ROSA_BISTRO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/reserve$/);
  });
  await whatsappFromRosa("wamid.4", "Done, I'm signed in.");
  const booked = await until(() => said(whatsapp, /^Booked Bistro Luna/), "the booking");
  const sentinel = (await logFor({ activations: () => Promise.resolve([]), pendingApprovals: () => Promise.resolve([]) }, "rosa")).done
    .filter((item) => item.kind === "sentinel")
    .map((item) => `${item.what} → ${item.outcome}`);
  assert.ok(sentinel.includes("GET bistro-luna.example/ → allow"));
  assert.ok(sentinel.includes("GET collect.example/c → block"), "the page's hidden instruction was blocked");
  assert.ok(sentinel.includes("POST bistro-luna.example/reserve → ask"));
  assert.ok(sentinel.includes("allow sending to bistro-luna.example → the person allowed it"));
  assert.ok(sentinel.includes("POST bistro-luna.example/reserve → allow"));
  assert.deepEqual((await instance()).context.sentinel, { read: [], write: ["bistro-luna.example"], blocked: [] });
  // Sites see it is an agent: the browser's own user agent, with its token added.
  assert.ok([...kuiperHere.userAgents].some((ua) => /^Mozilla\/5\.0 .*Chrome\//.test(ua) && ua.endsWith(` ${AGENT_TOKEN}`)), "it names itself to sites");
  // A read she allows is not a send: posting to a site she only let Muse read still goes to the Sentinel.
  const readOnly = new Sentinel({
    agentId: "check-muse", workspaceId: "check", request: {}, messageText: "",
    agentInstance: { context: { sentinel: { read: ["shop.example"], write: [], blocked: [] } } },
    data: { getAgent: () => Effect.succeed(undefined) },
  } as never);
  assert.equal((await readOnly.decide(new URL("http://shop.example/item"), "GET")).verdict, "allow");
  assert.equal((await readOnly.decide(new URL("http://shop.example/cart"), "POST")).verdict, "ask", "a read grant doesn't let it post");
  // Muse closed the browser, so her profile now holds the login: a new browser from it is signed in.
  const { sessionId: afterBooking, profileId, watchUrl: afterWatch } = await browserOf();
  assert.equal(afterBooking, undefined, "the closed browser is forgotten");
  assert.equal(afterWatch, undefined, "and so is its live view");
  assert.equal(await handOffOf("rosa"), undefined, "and the hand-off, with the session it opened");
  const kuiper = new Kuiper({ apiKey: kuiperHere.key, gatewayUrl: kuiperHere.url });
  const account = await kuiper.browsers.use({ profileId }, async (session) => {
    const browser = await chromium.connectOverCDP(session.websocketUrl);
    try {
      const page = browser.contexts()[0]!.pages()[0] ?? await browser.contexts()[0]!.newPage();
      await page.goto("http://bistro-luna.example/account");
      return await page.locator("body").innerText();
    } finally {
      await browser.close();
    }
  });
  assert.match(account, /Signed in as Rosa/, "her profile keeps the login");
  console.log(`5. the Sentinel: ${sentinel.join("; ")}. She signed in in the live view. ${reply(booked)} Her profile keeps the login. Her app could watch it; sites saw "${AGENT_TOKEN.split(" ")[0]}"; a read grant doesn't let it post.`);

  // 6. A one-time card, after she approves the purchase.
  await runtime.send(museId, app, "Order the groceries for Friday from Fresh Market.");
  const purchase = await approve("buy");
  assert.match(JSON.stringify(purchase.toolInput), /"amountCents":2340/);
  const ordered = await until(() => said(app, /^Ordered from Fresh Market/), "the order");
  const [paid] = await entries("purchase");
  assert.equal(paid?.merchant, "Fresh Market");
  assert.equal(kuiperHere.orders[0]?.cardLast4, paid?.cardLast4, "the shop was paid with the one-time card");
  console.log(`6. ${reply(ordered)}`);

  // 7. A plan, and long work: it checks back on its own.
  await runtime.send(museId, app, "Help me get ready for the half marathon on 6 December.");
  const plan = await until(() => said(app, /^Here's the plan/), "the plan");
  await whatsappFromRosa("wamid.5", "Watch the train fare to Boston on the 14th and tell me when it's under $60.");
  await until(() => said(whatsapp, /^I'll check the fare every 6 hours/), "the watch");
  const watch = await until(async () => (await runtime.listActivations("rosa")).find((item) => item.status === "active" && /train fare/.test(item.message)), "the schedule");
  assert.deepEqual(watch.timing, { kind: "every", intervalMs: 6 * 60 * 60 * 1000 });
  console.log(`7. ${reply(plan)} And it will check the train fare every 6 hours, on its own`);

  // 8. New mail that changes a plan reaches her on WhatsApp.
  const mail = {
    messageId: "m-104", threadId: "t-101",
    from: "Leo Martin <leo@example.com>", subject: "Re: Friday",
    snippet: "Could we make it 7:30 instead?", receivedAt: "2026-10-24T09:00:00.000Z",
    rfcMessageId: "<CAF-leo-104@mail.example.com>",
  };
  await runtime.dispatchInbound({ routeId: "rosa-gmail-in", eventId: mail.messageId, threadKey: mail.threadId, conversationKey: "app", conversationScope: "agent", raw: mail });
  const heads = await until(async () => (await entries("whatsapp")).find((item) => /7:30/.test(String(item.text))), "the heads-up");
  console.log(`8. new mail, to her WhatsApp: "${heads.text}"`);

  // 9. Forget.
  await runtime.send(museId, app, "Forget what I told you about Priya.");
  await until(() => said(app, /^Done\. I've forgotten/), "forgetting");
  await runtime.send(museId, app, "Who's vegetarian?");
  const forgotten = await until(() => said(app, /^I don't know of anyone vegetarian/), "the answer");
  const memoryLog = (await activityOf("rosa")).filter((item) => item.what.startsWith("glove_context_"));
  assert.ok(memoryLog.length >= 2 && memoryLog.every((item) => !/priya|vegetarian/i.test(item.detail ?? "")), "the log says memory changed, not what it kept");
  console.log(`9. after "forget": ${reply(forgotten)}`);

  // 10. The log, and she disconnects Calendar.
  const log = await logFor({
    activations: (workspaceId) => runtime.listActivations(workspaceId),
    pendingApprovals: () => runtime.listApprovals({ status: "pending" }),
  }, "rosa");
  const tools = log.done.filter((item) => item.kind === "tool").map((item) => item.what);
  for (const tool of [installedApplicationTransmissionToolName(gmailApp, gmail), "execute_browser", "buy", "request_access", "glove_context_unset"]) {
    assert.ok(tools.includes(tool), `the log has ${tool}`);
  }
  assert.ok(log.planned.some((item) => item.kind === "scheduled" && /train fare/.test(item.message)), "the fare watch is in the log");
  assert.ok(log.planned.some((item) => item.kind === "scheduled" && /^Suggestion pass/.test(item.message)), "so is the daily suggestion pass");
  assert.ok(log.planned.some((item) => item.kind === "plan step" && item.step === "Register for the race"), "and the plan's open steps");
  await disconnect(writes, museId, "rosa-calendar");
  assert.deepEqual(await appsOf(), ["gmail (act)", "whatsapp"]);
  const decisions = log.done.filter((item) => item.kind === "sentinel").length;
  console.log(`10. the log: ${tools.length} tool calls, ${decisions} Sentinel decisions and ${log.done.length - tools.length - decisions} browser events done, ${log.planned.length} planned (the fare watch, the daily suggestions, the plan's steps); Calendar disconnected`);

  // Her password, the card number and the live view never reached Muse: not in a transcript, a result or the log.
  const files = await readdir(dataDir, { recursive: true });
  const read = (name: string) => readFile(join(dataDir, name), "utf8").catch(() => "");
  const everything = (await Promise.all(files.filter((name) => /\.(json|jsonl)$/.test(name)).map(read))).join("\n");
  const muse = (await Promise.all(files.filter((name) => /\.(json|jsonl)$/.test(name) && !name.endsWith("ledger.jsonl")).map(read))).join("\n");
  assert.ok(!everything.includes(ROSA_BISTRO_PASSWORD), "she typed her password in the live view; it is nowhere");
  assert.ok(!new RegExp(`4000\\d{8}${paid?.cardLast4}`).test(everything), "the card number never left the payment");
  assert.ok(!muse.includes(String(link.text).split("token=")[1]), "the live view went to her on WhatsApp, never into Muse's context");

  console.log("\nMuse verified: one Muse in the app and on WhatsApp with one memory, apps at the access she chose, reads in code, a browser on Kuiper whose every request passes the Sentinel, a sign-in she does herself in the live view and a profile that keeps it, approvals for sending and paying, a one-time card typed in by host code, a plan made from a goal, long work it checks back on, news from new mail, forgetting, and a log of what it did and plans.");
} finally {
  await runtime.stop();
  await kuiperHere.close();
  if (process.env.MUSE_KEEP_DATA === "1") console.log(`data kept in ${dataDir}`);
  else await rm(dataDir, { recursive: true, force: true });
}

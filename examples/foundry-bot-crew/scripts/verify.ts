import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Maya's bots, end to end on the real runtime. There is one bot definition;
// every bot below is data, and so is every app she connects. With no API key
// each bot runs a short script and her accounts are samples, so this needs no
// network:
//   1. Maya's account is seeded: her main bot, which she named Chief, with her Gmail.
//   2. She makes a new bot and tells it its job; it names itself and gets her apps.
//   3. Bug Triage asks for Linear; she signs in and always allows filing; every bot has it.
//   4. Her main bot hands a bug to Bug Triage, which files it in Linear and hands the fix to Engineer.
//   5. Sales Outbound reads her inbox in code and emails a signup, after she approves.
//   6. A sign-in is handed back to her.
//   7. A workflow she shows a bot becomes a skill (after her review) and a routine.
//   8. A group chat: the host asks two bots, and both answer there.
//   9. New mail reaches her main bot, which replies in the thread once she approves.

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const dataDir = await mkdtemp(join(tmpdir(), "bot-crew-"));
process.env.CREW_DATA_DIR = dataDir;
process.env.CREW_DEMO = "1"; // the checks below follow the scripts

const { FoundryRuntime, installedApplicationTransmissionToolName } = await import("glove-foundry");
const { default: application } = await import("../foundry.application.js");
const { default: config } = await import("../foundry.config.js");
const { MAIN_THREAD, MAYA, botFor, groupChat } = await import("../lib/people.js");
const { connectApp, giveAccounts, sampleConnection, writesVia } = await import("../lib/connect.js");
const { default: gmailApp } = await import("../agents/bot/apps/gmail.app.js");
const { default: gmail } = await import("../agents/bot/transmissions/gmail.transmission.js");
const { entries } = await import("../lib/ledger.js");

const runtime = await FoundryRuntime.discover({
  rootDir,
  agentsDir: resolve(rootDir, "agents"),
  application,
  applicationFilePath: resolve(rootDir, "foundry.application.ts"),
  config,
});
await runtime.start();
const writes = writesVia.runtime(runtime);
const appsOf = (bot: { installations: ReadonlyArray<{ kind: string; id: string; accountId?: string }> }) =>
  bot.installations.filter((item) => item.kind === "application").map((item) => `${item.id} (${item.accountId})`);

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
const said = async (conversationId: string, pattern: RegExp) =>
  (await runtime.listRuns("bot")).find((run) =>
    run.conversationId === conversationId && run.status === "completed" && pattern.test(reply(run)));
const approve = async (tool: string) => {
  const approval = await until(async () =>
    (await runtime.listApprovals({ status: "pending" })).find((item) => item.toolName === tool), `${tool} to wait for approval`);
  await runtime.resolveApproval(approval.id, "approve");
  return approval;
};

try {
  assert.deepEqual(runtime.agents.map((agent) => agent.route), ["bot"], "one definition");
  const maya = MAYA;
  const sendTool = installedApplicationTransmissionToolName(gmailApp, gmail);

  // 1. The seeded account: her main bot and its thread, with her Gmail.
  const instances = async () => runtime.listAgentInstances("bot");
  const mainBot = (await instances()).find((agent) => agent.context.primary === true && agent.workspaceId === maya.id);
  assert.ok(mainBot, "Maya's main bot is seeded");
  assert.equal(mainBot.name, "Chief");
  assert.deepEqual(appsOf(mainBot), ["gmail (maya-gmail)"], "her Gmail, installed with her account");
  const [main] = (await runtime.listConversations(mainBot.id)).filter((item) => item.context.conversationKey === MAIN_THREAD.key);
  assert.ok(main, "its main thread is seeded");
  const hello = await runtime.send(mainBot.id, main.id, "Hi, I'm Maya.");
  assert.equal((await runtime.waitForRun(hello.id, { timeoutMs: 60_000 }))?.status, "completed");
  const watching = await until(async () => runtime.listApplicationConnections().find((item) => item.accountId === "maya-gmail" && item.status === "connected"), "the Gmail watch");
  console.log(`1. ${mainBot.name} (${mainBot.id}) is Maya's main bot, with ${appsOf(mainBot).join(", ")}; the Gmail watch is ${watching.status}`);

  // 2. A blank bot asks what it's for and names itself: a write to its own data.
  const fresh = await runtime.createAgent("bot", botFor(maya, { id: "maya-bot-1" }));
  await giveAccounts(writes, fresh.id, maya);
  const freshChat = await runtime.createConversation(fresh.id, { id: "maya-bot-1-chat", workspaceId: maya.id });
  const job = await runtime.send(fresh.id, freshChat.id,
    "Overnight pipeline generation and outbound. Pick eligible prospects from the signup emails, research them, and draft emails in my voice.");
  const renamedRun = await runtime.waitForRun(job.id, { timeoutMs: 60_000 });
  const renamed = (await instances()).find((agent) => agent.id === fresh.id);
  assert.equal(renamed?.name, "Sales Outbound");
  assert.match(renamed?.description ?? "", /Overnight pipeline/);
  assert.deepEqual(appsOf(renamed!), ["gmail (maya-gmail)"], "a new bot gets her apps");
  console.log(`2. "${fresh.name}" became "${renamed?.name}": ${reply(renamedRun)}`);

  // Two more bots, created with their jobs already set, and her apps.
  for (const [id, name, job] of [
    ["maya-bot-2", "Bug Triage", "Reproduces bug reports and files them in Linear, then gets them fixed."],
    ["maya-bot-3", "Engineer", "Fixes filed bugs on a branch and adds a test."],
  ] as const) {
    await runtime.createAgent("bot", botFor(maya, { id, name, job }));
    await giveAccounts(writes, id, maya);
  }

  // 3. Apps are the account's: one bot asks, Maya signs in, every bot has it.
  const triageChat = await runtime.createConversation("maya-bot-2", { id: "maya-bot-2-chat", workspaceId: maya.id });
  await runtime.send("maya-bot-2", triageChat.id, "We track bugs in Linear. Connect it.");
  const ask = await until(async () =>
    (await runtime.listApprovals({ status: "pending" })).find((item) => item.toolName === "connect_app"), "connect_app to wait for approval");
  // Your app's Connect button: the provider's sign-in, then the account is saved
  // and given to every bot. Maya ticks "Always allow" for filing issues.
  await connectApp(writes, maya, "linear", { ...sampleConnection(maya, "linear"), alwaysAllow: ["save_issue"] });
  await runtime.resolveApproval(ask.id, "approve");
  await until(() => said(triageChat.id, /^Linear is connected/), "Linear to connect");
  const team = (await instances()).filter((agent) => agent.workspaceId === maya.id);
  assert.equal(team.length, 4);
  for (const member of team) assert.ok(appsOf(member).includes("linear (maya-linear)"), `${member.name} has Linear`);
  console.log(`3. Bug Triage asked for Linear; once Maya signed in, all ${team.length} of her bots have it`);

  // 4. Main bot → Bug Triage → Engineer, and back. Filing runs in code: Maya always allows it.
  await runtime.send(mainBot.id, main.id, "The export button crashes on empty reports. Get it fixed.");
  const fixed = await until(() => said(main.id, /^Bug Triage: Fixed: Patched/), "the fix to reach the main bot");
  const [toTriage] = await runtime.listThreads({ conversationId: main.id });
  assert.equal(toTriage?.to.agentId, "maya-bot-2");
  const [toEngineer] = await runtime.listThreads({ agentId: "maya-bot-2" });
  assert.equal(toEngineer?.to.name, "Engineer", "bots message each other by id");
  assert.deepEqual((await entries("ticket")).map((ticket) => ticket.id), ["ENG-1"]);
  console.log(`4. in the main thread: ${reply(fixed)}`);

  // 5. Reading her inbox happens in code; sending waits for her, and goes out from her address.
  const sales = await runtime.createConversation("maya-bot-1", { id: "maya-sales-chat", workspaceId: maya.id });
  await runtime.send("maya-bot-1", sales.id, "Find this week's signups in my inbox and send Dana an intro.");
  const approval = await approve(sendTool);
  assert.match(JSON.stringify(approval), /dana@example\.com/, "she approves the exact email");
  const sent = await until(() => said(sales.id, /^Sent the intro/), "the email");
  const [email] = await entries("email");
  assert.equal(email?.from, "maya@example.com");
  assert.equal(email?.to, "dana@example.com");
  console.log(`5. after approval: ${reply(sent)}`);

  // 6. A login is handed back; the bot never sees the password.
  await runtime.send("maya-bot-1", sales.id, "Sign in to Salesforce and pull the open deals.");
  await approve("request_sign_in");
  const signedIn = await until(() => said(sales.id, /^Signed in to Salesforce/), "the sign-in");
  console.log(`6. after Maya signed in: ${reply(signedIn)}`);

  // 7. Shown once: a skill for every bot on her team, and a routine for this one.
  await runtime.send("maya-bot-1", sales.id, "Every Monday at 9, sweep last week's signups and draft an intro for each.");
  await approve("save_skill");
  await until(() => said(sales.id, /^Saved monday-signups/), "the routine");
  const skills = (await runtime.listWorkspaceEntries(maya.id)).filter((entry) => entry.key.startsWith("skill:"));
  assert.deepEqual(skills.map((entry) => entry.key), ["skill:monday-signups"]);
  const routine = await until(async () =>
    (await runtime.listActivations()).find((item) => item.agentId === "maya-bot-1" && item.timing.kind === "cron"), "the routine's schedule");
  assert.deepEqual(routine.timing, { kind: "cron", expression: "0 9 * * 1", timezone: "UTC" });
  console.log("7. skill monday-signups saved for the team; routine every Monday at 09:00");

  // 8. A group chat is a conversation, hosted by the bot it is on, whose data lists its bots.
  const offsite = await runtime.createConversation(mainBot.id, { ...groupChat({ id: "maya-offsite", name: "Offsite crew", members: ["maya-bot-1", "maya-bot-2"] }), workspaceId: maya.id });
  await runtime.send(mainBot.id, offsite.id, "@Sales Outbound how many leads this week? @Bug Triage anything blocking?");
  await until(() => said(offsite.id, /^Sales Outbound: 14 new leads/), "Sales Outbound's answer");
  await until(() => said(offsite.id, /^Bug Triage: Nothing blocking/), "Bug Triage's answer");
  assert.equal((await runtime.listThreads({ conversationId: offsite.id })).length, 2);
  console.log("8. Offsite crew: both bots answered in the group chat");

  // 9. New mail, the way the Gmail watch passes it in: her main bot answers in the thread.
  const mail = {
    messageId: "m-103",
    threadId: "t-103",
    from: "Lena Park <lena@northwind.example>",
    subject: "Export API pricing?",
    snippet: "Hi, what does the export API cost for a team of 40?",
    receivedAt: "2026-10-24T08:05:00.000Z",
    rfcMessageId: "<CAF-lena-103@mail.northwind.example>",
  };
  const runs = await runtime.dispatchInbound({
    routeId: "maya-gmail-in", eventId: mail.messageId, threadKey: mail.threadId,
    conversationKey: MAIN_THREAD.key, conversationScope: "agent", raw: mail,
  });
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.conversationId, main.id, "new mail joins her main bot's thread");
  await approve(sendTool);
  const answered = await until(() => said(main.id, /^Replied to Lena Park/), "the reply");
  const replyEmail = (await entries("email")).find((item) => item.to === "lena@northwind.example");
  assert.equal(replyEmail?.threadId, "t-103");
  assert.equal(replyEmail?.inReplyTo, mail.rfcMessageId, "the reply lands in Lena's thread too");
  assert.deepEqual(await runtime.dispatchInbound({
    routeId: "maya-gmail-in", eventId: mail.messageId, threadKey: mail.threadId, raw: mail,
  }).then((again) => again.map((run) => run.id)), runs.map((run) => run.id), "the same message is handled once");
  console.log(`9. new mail: ${reply(answered)}`);

  console.log("\nBots verified: one definition, every bot and every connected app in data, apps read in code, sends approved and delivered by Foundry, mesh between bots, sign-in, skills and routines, group chat, new mail.");
} finally {
  await runtime.stop();
  await rm(dataDir, { recursive: true, force: true });
}

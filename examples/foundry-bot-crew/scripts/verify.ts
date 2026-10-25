import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Maya's bots, end to end on the real runtime. There is one bot definition;
// every bot below is data, and so is every app she connects. With no API key
// each bot runs a short script and her accounts are samples, so this needs no
// network:
// The bots are siblings: no bot routes work to the others.
//   1. Maya's account is seeded: her first bot, Inbox Manager, with her Gmail and a routine on new mail.
//   2. She makes a new bot and tells it its job; it names itself and gets her apps.
//   3. Bug Triage asks for Linear; she signs in and always allows filing; every bot has it.
//   4. She tells Bug Triage about a bug; it files it in Linear and hands the fix to Engineer, a sibling.
//   5. Sales Outbound reads her inbox in code and emails a signup, after she approves.
//   6. A sign-in is handed back to her.
//   7. A workflow becomes a skill (after her review) and a Monday routine; Bug Triage gets a routine on new mail.
//   8. A group chat with no host: the two bots she @-mentions answer; the third stays quiet.
//   9. New mail reaches each bot whose routine is on new mail; Inbox Manager replies once she approves.

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const dataDir = await mkdtemp(join(tmpdir(), "bot-crew-"));
process.env.CREW_DATA_DIR = dataDir;
process.env.CREW_DEMO = "1"; // the checks below follow the scripts

const { FoundryRuntime, installedApplicationTransmissionToolName } = await import("glove-foundry");
const { default: application } = await import("../foundry.application.js");
const { default: config } = await import("../foundry.config.js");
const { CHAT, MAYA, botFor, chatWith } = await import("../lib/people.js");
const { chatsVia, groupConversationId, openGroup, postToGroup } = await import("../lib/groups.js");
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

  // 1. The seeded account: her first bot, with her Gmail and a routine on new mail.
  const instances = async () => runtime.listAgentInstances("bot");
  const inbox = (await instances()).find((agent) => agent.id === "maya-inbox");
  assert.ok(inbox, "Maya's first bot is seeded");
  assert.equal(inbox.name, "Inbox Manager");
  assert.deepEqual(appsOf(inbox), ["gmail (maya-gmail)"], "her Gmail, installed with her account");
  assert.deepEqual((inbox.context.routines as Array<{ on: string }>).map((routine) => routine.on), ["new-mail"]);
  const [inboxChat] = (await runtime.listConversations(inbox.id)).filter((item) => item.context.conversationKey === CHAT.key);
  assert.ok(inboxChat, "its chat is seeded");
  const hello = await runtime.send(inbox.id, inboxChat.id, "Hi, I'm Maya.");
  assert.equal((await runtime.waitForRun(hello.id, { timeoutMs: 60_000 }))?.status, "completed");
  const watching = await until(async () => runtime.listApplicationConnections().find((item) => item.accountId === "maya-gmail" && item.status === "connected"), "the Gmail watch");
  console.log(`1. ${inbox.name} (${inbox.id}) has ${appsOf(inbox).join(", ")} and a routine on new mail; the Gmail watch is ${watching.status}`);

  // 2. A blank bot asks what it's for and names itself: a write to its own data.
  const fresh = await runtime.createAgent("bot", botFor(maya, { id: "maya-bot-1" }));
  await giveAccounts(writes, fresh.id, maya);
  const freshChat = await runtime.createConversation(fresh.id, chatWith(fresh.id));
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
  const triageChat = await runtime.createConversation("maya-bot-2", chatWith("maya-bot-2"));
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

  // 4. Maya writes to Bug Triage; it files the bug and hands the fix to a sibling.
  // Filing is a direct tool that Maya always allows, so it runs without asking.
  await runtime.send("maya-bot-2", triageChat.id, "The export button crashes on empty reports. Get it fixed.");
  const fixed = await until(() => said(triageChat.id, /^Fixed: Patched/), "the fix");
  const [toEngineer] = await runtime.listThreads({ agentId: "maya-bot-2" });
  assert.equal(toEngineer?.to.name, "Engineer", "siblings message each other by id");
  assert.deepEqual((await entries("ticket")).map((ticket) => ticket.id), ["ENG-1"]);
  console.log(`4. Bug Triage, after asking Engineer: ${reply(fixed)}`);

  // 5. Reading her inbox happens in code; sending waits for her, and goes out from her address.
  const sales = freshChat;
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
  // A routine after an event is data on the bot it belongs to.
  await runtime.send("maya-bot-2", triageChat.id, "When a bug report lands in my inbox, file it.");
  await until(() => said(triageChat.id, /^Done\. I'll file bug reports/), "Bug Triage's routine");
  const triage = (await instances()).find((agent) => agent.id === "maya-bot-2");
  assert.deepEqual((triage?.context.routines as Array<{ on: string }>).map((item) => item.on), ["new-mail"]);
  console.log("7. skill monday-signups saved for the team; Sales Outbound runs it every Monday at 09:00; Bug Triage has a routine on new mail");

  // 8. A group chat with no host: each member has its own side, and a message
  // goes to the bots it @-mentions. Inbox Manager is in it and stays quiet.
  const offsite = { id: "offsite", name: "Offsite crew", members: ["maya-inbox", "maya-bot-1", "maya-bot-2"] };
  const chats = chatsVia.runtime(runtime);
  await openGroup(chats, offsite);
  const posted = await postToGroup(chats, offsite, "@Sales Outbound how many leads this week? @Bug Triage anything blocking?");
  assert.deepEqual(posted.map((item) => item.botId), ["maya-bot-1", "maya-bot-2"], "only the bots she mentioned");
  await until(() => said(groupConversationId("maya-bot-1", offsite), /^14 new leads/), "Sales Outbound's answer");
  await until(() => said(groupConversationId("maya-bot-2", offsite), /^Nothing blocking/), "Bug Triage's answer");
  assert.equal((await runtime.listRuns("bot")).filter((run) => run.conversationId === groupConversationId("maya-inbox", offsite)).length, 0);
  console.log("8. Offsite crew: Sales Outbound and Bug Triage answered; Inbox Manager wasn't mentioned and stayed quiet");

  // 9. New mail, the way the Gmail watch passes it in: it reaches each bot whose
  // routine is on new mail, in that bot's chat. Sales Outbound has Gmail too,
  // but no such routine.
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
    conversationKey: CHAT.key, conversationScope: "agent", raw: mail,
  });
  assert.deepEqual(runs.map((run) => run.agentId).sort(), ["maya-bot-2", "maya-inbox"], "the bots with a routine on new mail");
  assert.deepEqual(runs.map((run) => run.conversationId).sort(), [triageChat.id, inboxChat.id].sort(), "each in its own chat");
  await until(() => said(triageChat.id, /^Not a bug report/), "Bug Triage to pass on it");
  await approve(sendTool);
  const answered = await until(() => said(inboxChat.id, /^Replied to Lena Park/), "the reply");
  const replyEmail = (await entries("email")).find((item) => item.to === "lena@northwind.example");
  assert.equal(replyEmail?.threadId, "t-103");
  assert.equal(replyEmail?.inReplyTo, mail.rfcMessageId, "the reply lands in Lena's thread too");
  assert.deepEqual(await runtime.dispatchInbound({
    routeId: "maya-gmail-in", eventId: mail.messageId, threadKey: mail.threadId, raw: mail,
  }).then((again) => again.map((run) => run.id)), runs.map((run) => run.id), "the same message is handled once");
  console.log(`9. new mail woke Inbox Manager and Bug Triage. Bug Triage: not a bug. Inbox Manager: ${reply(answered)}`);

  console.log("\nBots verified: one definition and sibling bots in data, connected apps read in code, sends approved and delivered by Foundry, handoffs between siblings, sign-in, skills and routines, a group chat with no host, new mail to the bots whose routines ask for it.");
} finally {
  await runtime.stop();
  await rm(dataDir, { recursive: true, force: true });
}

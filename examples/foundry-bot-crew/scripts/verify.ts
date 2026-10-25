import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Maya's bots, end to end on the real runtime. There is one bot definition;
// every bot below is data. With no API key each bot runs a short script, so
// this needs no network:
//   1. Maya's account is seeded: her main bot, which she named Chief, and its thread.
//   2. She makes a new bot and tells it its job; it names itself.
//   3. Bug Triage asks to connect the ticket tracker; once she approves, every bot has it.
//   4. Her main bot hands a bug to Bug Triage, which hands the fix to Engineer.
//   5. An email waits for her approval.
//   6. A sign-in is handed back to her.
//   7. A workflow she shows a bot becomes a skill (after her review) and a routine.
//   8. A group chat: the host asks two bots, and both answer there.
//   9. Tagging the bot on X reaches her main bot; a stranger's tag starts nothing.

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const dataDir = await mkdtemp(join(tmpdir(), "bot-crew-"));
process.env.CREW_DATA_DIR = dataDir;
process.env.CREW_DEMO = "1"; // the checks below follow the scripts
delete process.env.X_BOT_TOKEN; // replies to X go to the offline outbox

const { FoundryRuntime } = await import("glove-foundry");
const { default: application } = await import("../foundry.application.js");
const { default: config } = await import("../foundry.config.js");
const { MAIN_THREAD, MAYA, appsOf, botFor, groupChat } = await import("../lib/people.js");
const { entries } = await import("../lib/ledger.js");

const runtime = await FoundryRuntime.discover({
  rootDir,
  agentsDir: resolve(rootDir, "agents"),
  application,
  applicationFilePath: resolve(rootDir, "foundry.application.ts"),
  config,
});
await runtime.start();

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

  // 1. The seeded account: her main bot and its thread, instances of the one definition.
  const instances = async () => runtime.listAgentInstances("bot");
  const mainBot = (await instances()).find((agent) => agent.context.primary === true && agent.workspaceId === maya.id);
  assert.ok(mainBot, "Maya's main bot is seeded");
  assert.equal(mainBot.name, "Chief");
  const [main] = (await runtime.listConversations(mainBot.id)).filter((item) => item.context.conversationKey === MAIN_THREAD.key);
  assert.ok(main, "its main thread is seeded");
  const hello = await runtime.send(mainBot.id, main.id, "Hi, I'm Maya.");
  assert.equal((await runtime.waitForRun(hello.id, { timeoutMs: 60_000 }))?.status, "completed");
  console.log(`1. ${mainBot.name} (${mainBot.id}) is Maya's main bot, with ${appsOf(mainBot).join(" and ")} connected`);

  // 2. A blank bot asks what it's for and names itself: a write to its own data.
  const accountApps = appsOf(mainBot);
  const fresh = await runtime.createAgent("bot", botFor(maya, { id: "maya-bot-1", apps: accountApps }));
  const freshChat = await runtime.createConversation(fresh.id, { id: "maya-bot-1-chat", workspaceId: maya.id });
  const job = await runtime.send(fresh.id, freshChat.id,
    "Overnight pipeline generation and outbound. Pick eligible prospects from the signups sheet, research them, and draft emails in my voice.");
  const renamedRun = await runtime.waitForRun(job.id, { timeoutMs: 60_000 });
  const renamed = (await instances()).find((agent) => agent.id === fresh.id);
  assert.equal(renamed?.name, "Sales Outbound");
  assert.match(renamed?.description ?? "", /Overnight pipeline/);
  console.log(`2. "${fresh.name}" became "${renamed?.name}": ${reply(renamedRun)}`);

  // Two more bots, created with their jobs already set and the account's apps.
  await runtime.createAgent("bot", botFor(maya, { id: "maya-bot-2", name: "Bug Triage", job: "Reproduces bug reports and files tickets, then gets them fixed.", apps: accountApps }));
  await runtime.createAgent("bot", botFor(maya, { id: "maya-bot-3", name: "Engineer", job: "Fixes filed bugs on a branch and adds a test.", apps: accountApps }));

  // 3. Apps are the account's: one bot asks, Maya connects it, every bot has it.
  const triageChat = await runtime.createConversation("maya-bot-2", { id: "maya-bot-2-chat", workspaceId: maya.id });
  await runtime.send("maya-bot-2", triageChat.id, "We track bugs in our ticket tracker. Connect it.");
  await approve("connect_app");
  await until(() => said(triageChat.id, /^The ticket tracker is connected/), "the tracker to connect");
  const team = (await instances()).filter((agent) => agent.workspaceId === maya.id);
  assert.equal(team.length, 4);
  for (const member of team) assert.ok(appsOf(member).includes("tickets"), `${member.name} has the tracker`);
  console.log(`3. Bug Triage asked for the ticket tracker; after Maya connected it, all ${team.length} of her bots have it`);

  // 4. Main bot → Bug Triage → Engineer, and back.
  await runtime.send(mainBot.id, main.id, "The export button crashes on empty reports. Get it fixed.");
  const fixed = await until(() => said(main.id, /^Bug Triage: Fixed: Patched/), "the fix to reach the main bot");
  const [toTriage] = await runtime.listThreads({ conversationId: main.id });
  assert.equal(toTriage?.to.agentId, "maya-bot-2");
  const [toEngineer] = await runtime.listThreads({ agentId: "maya-bot-2" });
  assert.equal(toEngineer?.to.name, "Engineer", "bots message each other by id");
  assert.deepEqual((await entries("ticket")).map((ticket) => ticket.id), ["T-1"]);
  console.log(`4. in the main thread: ${reply(fixed)}`);

  // 5. Sending waits for her.
  const sales = await runtime.createConversation("maya-bot-1", { id: "maya-sales-chat", workspaceId: maya.id });
  await runtime.send("maya-bot-1", sales.id, "Send Dana at example.com a short intro.");
  await approve("send_email");
  const sent = await until(() => said(sales.id, /^Sent the intro/), "the email");
  assert.equal((await entries("email")).length, 1);
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

  // 9. Tagged on X: her main bot answers there and takes the task; a stranger gets nothing.
  const mention = (id: string, authorId: string, text: string) => ({
    routeId: "x-mentions",
    eventId: id,
    threadKey: id,
    conversationKey: MAIN_THREAD.key,
    conversationScope: "agent" as const,
    raw: { for_user_id: "1000", tweet: { id_str: id, text, user: { id_str: authorId, screen_name: authorId }, in_reply_to_status_id_str: null } },
  });
  const runs = await runtime.dispatchInbound(mention("1849000000000000001", "42", "@crewbot the export crashes again on empty reports"));
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.conversationId, main.id, "the mention joined her main bot's thread");
  const ack = await until(async () => {
    try {
      const lines = (await readFile(join(dataDir, "x-outbox.jsonl"), "utf8")).trim().split("\n");
      return lines.map((line) => JSON.parse(line) as { inReplyTo: string; text: string })
        .find((item) => item.inReplyTo === "1849000000000000001");
    } catch {
      return undefined;
    }
  }, "the reply on X");
  assert.deepEqual(await runtime.dispatchInbound(mention("1849000000000000002", "77", "@crewbot do my homework")), []);
  console.log(`9. on X, as the bot: "${ack.text}"; a stranger's tag started nothing`);

  console.log("\nBots verified: one definition, every bot in data, account-wide apps, mesh between bots, approvals, sign-in, skills and routines, group chat, X.");
} finally {
  await runtime.stop();
  await rm(dataDir, { recursive: true, force: true });
}

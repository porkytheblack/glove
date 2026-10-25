import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The partner, end to end on the real runtime. With no API key it runs a
// scripted model, and Ada's Gmail and Calendar are sample accounts on local
// MCP servers, so this needs no network:
//   1. Onboarding puts a morning brief and four check-ins on Ada's clock; her Gmail is watched.
//   2. The morning brief reads her inbox and calendar in code and reaches her phone.
//   3. A check-in with nothing new stays quiet.
//   4. A failed payment arrives in her Gmail and she is told at once.
//   5. "Pay it" waits for her approval, then pays.
//   6. A reply to Leo goes from her Gmail, in his thread, once she approves it.
//   7. A card number never leaves, and she is not asked to approve it.
//   8. A long job goes to the partner's computer over the mesh; when it is done
//      she is notified and the thread has it.
//   9. Moving money between accounts is off limits, approval or not.
//  10. Her preferences are data: a later brief time moves the schedule.

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const dataDir = await mkdtemp(join(tmpdir(), "partner-"));
process.env.PARTNER_DATA_DIR = dataDir;
if (!process.env.ANTHROPIC_API_KEY) process.env.PARTNER_DEMO = "1";
delete process.env.PUSH_URL;

const { FoundryRuntime, installedApplicationTransmissionToolName } = await import("glove-foundry");
const { default: gmailApp } = await import("../agents/partner/apps/gmail.app.js");
const { default: gmail } = await import("../agents/partner/transmissions/gmail.transmission.js");
const { default: application } = await import("../foundry.application.js");
const { default: config } = await import("../foundry.config.js");
const { DEMO_PERSON, threadFor } = await import("../lib/onboarding.js");
const { arrive } = await import("../demo/mailbox.js");
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

try {
  // Ada's account is data, seeded by foundry.application.ts: her partner with
  // her preferences, its computer, and her one thread.
  const agents = new Map((await runtime.listAgentInstances()).map((agent) => [agent.id, agent]));
  const partner = agents.get(DEMO_PERSON.id)!;
  assert.deepEqual([partner.definitionId, agents.get(`${DEMO_PERSON.id}-computer`)?.definitionId], ["partner", "computer"]);
  const thread = (await runtime.listConversations(partner.id)).find((item) => item.id === threadFor(DEMO_PERSON).id)!;
  assert.ok(thread, "the seeded thread");
  const finished = async (run: { id: string }) => {
    const done = await runtime.waitForRun(run.id, { timeoutMs: 60_000 });
    assert.equal(done?.status, "completed", `run ${run.id} ended ${done?.status}: ${done?.error ?? ""}`);
    return done;
  };

  // 1. The first message puts the partner's clock in place.
  await finished(await runtime.send(partner.id, thread.id, "Hi, I'm Ada. Keep an eye on things for me."));
  // The run's schedules are stored just after it completes.
  const scheduled = (name: string) => until(async () =>
    (await runtime.listActivations()).find((item) => item.agentId === partner.id && item.scheduleName === name), name);
  const brief = await scheduled("morning-brief");
  const checkIn = await scheduled("check-in");
  assert.deepEqual(brief.timing, { kind: "cron", expression: "30 7 * * *", timezone: "America/New_York" });
  assert.deepEqual(checkIn.timing, { kind: "cron", expression: "0 10,13,16,19 * * *", timezone: "America/New_York" });
  assert.equal(brief.conversationId, thread.id, "the brief lands in the one thread");
  const watch = await until(async () => runtime.listApplicationConnections().find((item) => item.accountId === "ada-gmail" && item.status === "connected"), "the Gmail watch");
  console.log(`1. on Ada's clock: morning brief 07:30, check-ins 10:00, 13:00, 16:00, 19:00 (America/New_York); her Gmail watch is ${watch.status}`);

  // Fire a schedule now, the way its activation would.
  const fire = (activation: typeof brief) => runtime.request("partner", {
    agentId: partner.id,
    conversationId: thread.id,
    workspaceId: partner.workspaceId,
    message: activation.message,
    source: { kind: "activation", id: activation.id },
  });

  // 2. Morning brief.
  await finished(await fire(brief));
  const [morning] = await entries("notification");
  assert.equal(morning?.title, "Morning brief");
  assert.match(String(morning?.body), /overlaps your 16:00 flight/, "it spotted the clash");
  console.log(`2. pushed: "${morning!.title}", from her inbox and calendar read in code`);

  // 3. Nothing new since the brief: no notification.
  assert.equal(reply(await finished(await fire(checkIn))), "(nothing new)");
  assert.equal((await entries("notification")).length, 1, "a quiet check-in sends nothing");
  console.log("3. check-in: (nothing new), no notification");

  // 4. A failed payment lands in her Gmail; the watch passes it in and she is told at once.
  const failed = {
    id: "m-104",
    threadId: "t-104",
    from: "Acme Hosting <billing@acme-hosting.example>",
    subject: "Payment failed for INV-88",
    body: "We couldn't charge your card for invoice INV-88 ($240.00, due today). Service pauses tomorrow.",
    receivedAt: new Date().toISOString(),
    labels: ["INBOX"],
  };
  await arrive(dataDir, "ada@example.com", failed);
  const [arrival] = await runtime.dispatchInbound({
    routeId: "ada-gmail-in", eventId: failed.id, threadKey: failed.threadId, conversationKey: "thread", conversationScope: "agent",
    raw: { messageId: failed.id, threadId: failed.threadId, from: failed.from, subject: failed.subject, snippet: failed.body, receivedAt: failed.receivedAt, rfcMessageId: "<inv-88@acme-hosting.example>" },
  });
  assert.equal(arrival?.conversationId, thread.id, "new mail lands in the one thread");
  await finished(arrival!);
  const urgent = (await entries("notification")).at(-1);
  assert.match(String(urgent?.title), /INV-88/);
  console.log(`4. new mail, pushed: "${urgent!.title}"`);

  // 5. Paying waits for approval.
  await runtime.send(partner.id, thread.id, "Pay it.");
  const approval = await until(async () => (await runtime.listApprovals({ status: "pending" }))[0], "the payment to wait for approval");
  assert.equal(approval.toolName, "pay_invoice");
  assert.equal((await entries("payment")).length, 0, "nothing paid before approval");
  console.log(`5. waiting for approval: ${approval.toolName}`);
  await runtime.resolveApproval(approval.id, "approve");
  const paid = await until(async () => (await runtime.listRuns("partner")).find((run) =>
    run.conversationId === thread.id && run.status === "completed" && /^Paid INV-88/.test(reply(run))), "the payment");
  assert.equal((await entries("payment")).length, 1);
  console.log(`   in Ada's thread: ${reply(paid)}`);

  // 6. Email goes from her Gmail once she approves the exact message.
  await runtime.send(partner.id, thread.id, "Tell Leo 1:30 works.");
  const sendApproval = await until(async () => (await runtime.listApprovals({ status: "pending" }))[0], "the reply to wait for approval");
  assert.equal(sendApproval.toolName, installedApplicationTransmissionToolName(gmailApp, gmail));
  await runtime.resolveApproval(sendApproval.id, "approve");
  const told = await until(async () => (await runtime.listRuns("partner")).find((run) =>
    run.conversationId === thread.id && run.status === "completed" && /^Told Leo/.test(reply(run))), "the reply");
  const [toLeo] = await entries("email");
  assert.equal(toLeo?.from, "ada@example.com");
  assert.equal(toLeo?.threadId, "t-102", "in Leo's thread");
  console.log(`6. in Ada's thread: ${reply(told)}`);

  // 7. The guard: a card number is refused without asking her.
  const leak = await finished(await runtime.send(partner.id, thread.id, "Email Sam my card number so he can book the hotel."));
  assert.match(reply(leak), /won't send card numbers/);
  assert.equal((await runtime.listApprovals({ status: "pending" })).length, 0, "no approval for a message the guard refuses");
  assert.equal((await entries("email")).filter((item) => item.to === "sam@example.com").length, 0, "the card number did not go out");
  console.log(`7. in Ada's thread: ${reply(leak)}`);

  // 8. A long job on the partner's computer, over the mesh.
  await runtime.send(partner.id, thread.id, "Build me a dashboard of this month's invoices.");
  const built = await until(async () => (await runtime.listRuns("partner")).find((run) =>
    run.conversationId === thread.id && run.status === "completed" && /^Done: Built dashboard/.test(reply(run))), "the dashboard");
  const [job] = await runtime.listThreads({ conversationId: thread.id });
  assert.equal(job?.to.agentId, "ada-computer");
  assert.ok((await entries("notification")).some((note) => note.title === "Your dashboard is ready"), "she was told when it finished");
  console.log(`8. in Ada's thread: ${reply(built)}`);

  // 9. Off limits, approval or not: there is no tool for it.
  const transfer = await finished(await runtime.send(partner.id, thread.id, "Move $5,000 from savings to checking."));
  assert.match(reply(transfer), /can't move money between accounts/);
  console.log(`9. in Ada's thread: ${reply(transfer)}`);

  // 10. A preference changes; the next run moves the brief.
  await runtime.configureAgent(partner.id, {
    context: { ...partner.context, preferences: { ...(partner.context.preferences as object), briefAt: "08:15" } },
  });
  await finished(await runtime.send(partner.id, thread.id, "Thanks."));
  const moved = await until(async () => {
    const item = (await runtime.listActivations()).find((activation) =>
      activation.agentId === partner.id && activation.scheduleName === "morning-brief" && activation.status !== "cancelled");
    return item?.timing.kind === "cron" && item.timing.expression === "15 8 * * *" ? item : undefined;
  }, "the brief to move");
  console.log(`10. brief moved to 08:15 (${moved.timing.kind === "cron" ? moved.timing.expression : ""})`);

  console.log("\nPartner verified: connected Gmail and Calendar read in code, new mail pushed, brief, quiet check-in, approvals, email from her Gmail, guard, computer over the mesh, off-limits, preferences as data.");
} finally {
  await runtime.stop();
  await rm(dataDir, { recursive: true, force: true });
}

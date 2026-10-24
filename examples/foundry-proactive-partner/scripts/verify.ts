import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The partner, end to end on the real runtime. With no API key it runs a
// scripted model, so this needs no network:
//   1. Onboarding puts a morning brief and four check-ins on Ada's clock.
//   2. The morning brief reaches her phone.
//   3. A check-in with nothing new stays quiet.
//   4. A check-in that finds a failed payment notifies her.
//   5. "Pay it" waits for her approval, then pays.
//   6. A card number never leaves, and she is not asked to approve it.
//   7. A long job goes to the partner's computer over the mesh; when it is done
//      she is notified and the thread has it.
//   8. Moving money between accounts is off limits, approval or not.
//   9. Her preferences are data: a later brief time moves the schedule.

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const dataDir = await mkdtemp(join(tmpdir(), "partner-"));
process.env.PARTNER_DATA_DIR = dataDir;
if (!process.env.ANTHROPIC_API_KEY) process.env.PARTNER_DEMO = "1";
delete process.env.PUSH_URL;

const { FoundryRuntime } = await import("glove-foundry");
const { default: application } = await import("../foundry.application.js");
const { default: config } = await import("../foundry.config.js");
const { computerFor, partnerFor, threadFor } = await import("../lib/onboarding.js");
const { deliver } = await import("../lib/connectors.js");
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
  const ada = { id: "ada", name: "Ada", timezone: "America/New_York" };
  // Ada's account is data: her partner, with her preferences, and its computer.
  const partner = await runtime.createAgent("partner", partnerFor(ada));
  await runtime.createAgent("computer", computerFor(ada));
  const thread = await runtime.createConversation(partner.id, threadFor(ada));
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
  console.log("on Ada's clock: morning brief 07:30, check-ins 10:00, 13:00, 16:00, 19:00 (America/New_York)");

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
  console.log(`pushed: "${morning!.title}"`);

  // 3. Nothing new since the brief: no notification.
  assert.equal(reply(await finished(await fire(checkIn))), "(nothing new)");
  assert.equal((await entries("notification")).length, 1, "a quiet check-in sends nothing");
  console.log("check-in: (nothing new), no notification");

  // 4. A failed payment arrives; the next check-in tells her.
  await deliver({
    id: "m-104",
    from: "Acme Hosting <billing@acme-hosting.example>",
    subject: "Payment failed for INV-88",
    body: "We couldn't charge your card for invoice INV-88 ($240.00, due today). Service pauses tomorrow.",
    receivedAt: new Date().toISOString(),
  });
  await finished(await fire(checkIn));
  const urgent = (await entries("notification")).at(-1);
  assert.match(String(urgent?.title), /INV-88/);
  console.log(`pushed: "${urgent!.title}"`);

  // 5. Paying waits for approval.
  await runtime.send(partner.id, thread.id, "Pay it.");
  const approval = await until(async () => (await runtime.listApprovals({ status: "pending" }))[0], "the payment to wait for approval");
  assert.equal(approval.toolName, "pay_invoice");
  assert.equal((await entries("payment")).length, 0, "nothing paid before approval");
  console.log(`waiting for approval: ${approval.toolName}`);
  await runtime.resolveApproval(approval.id, "approve");
  const paid = await until(async () => (await runtime.listRuns("partner")).find((run) =>
    run.conversationId === thread.id && run.status === "completed" && /^Paid INV-88/.test(reply(run))), "the payment");
  assert.equal((await entries("payment")).length, 1);
  console.log(`in Ada's thread: ${reply(paid)}`);

  // 6. The guard: a card number is refused without asking her.
  const leak = await finished(await runtime.send(partner.id, thread.id, "Text Sam my card number so he can book the hotel."));
  assert.match(reply(leak), /won't send card numbers/);
  assert.equal((await runtime.listApprovals({ status: "pending" })).length, 0, "no approval for a message the guard refuses");
  assert.equal((await entries("message")).length, 0, "the card number did not go out");
  console.log(`in Ada's thread: ${reply(leak)}`);

  // 7. A long job on the partner's computer, over the mesh.
  await runtime.send(partner.id, thread.id, "Build me a dashboard of this month's invoices.");
  const built = await until(async () => (await runtime.listRuns("partner")).find((run) =>
    run.conversationId === thread.id && run.status === "completed" && /^Done: Built dashboard/.test(reply(run))), "the dashboard");
  const [job] = await runtime.listThreads({ conversationId: thread.id });
  assert.equal(job?.to.agentId, "ada-computer");
  assert.ok((await entries("notification")).some((note) => note.title === "Your dashboard is ready"), "she was told when it finished");
  console.log(`in Ada's thread: ${reply(built)}`);

  // 8. Off limits, approval or not: there is no tool for it.
  const transfer = await finished(await runtime.send(partner.id, thread.id, "Move $5,000 from savings to checking."));
  assert.match(reply(transfer), /can't move money between accounts/);
  console.log(`in Ada's thread: ${reply(transfer)}`);

  // 9. A preference changes; the next run moves the brief.
  await runtime.configureAgent(partner.id, {
    context: { ...partner.context, preferences: { ...(partner.context.preferences as object), briefAt: "08:15" } },
  });
  await finished(await runtime.send(partner.id, thread.id, "Thanks."));
  const moved = await until(async () => {
    const item = (await runtime.listActivations()).find((activation) =>
      activation.agentId === partner.id && activation.scheduleName === "morning-brief" && activation.status !== "cancelled");
    return item?.timing.kind === "cron" && item.timing.expression === "15 8 * * *" ? item : undefined;
  }, "the brief to move");
  console.log(`brief moved to 08:15 (${moved.timing.kind === "cron" ? moved.timing.expression : ""})`);

  console.log("\nPartner verified: brief, quiet and urgent check-ins, approval, guard, computer over the mesh, off-limits, preferences as data.");
} finally {
  await runtime.stop();
  await rm(dataDir, { recursive: true, force: true });
}

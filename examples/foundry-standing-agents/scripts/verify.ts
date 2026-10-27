import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";

// Sam's dot, end to end on the real runtime with scripted models and the
// support mailbox Sam connected as a sample account. No network:
//   1. Sam's dot, Pip, his builder and their app conversation are seeded data,
//      with the support mailbox connected; its Gmail watch is running.
//   2. A research run reads #feedback and the mailbox (in code, through the
//      Gmail app), keeps notes, suggests one thing, and has no tool that acts,
//      no mesh, no computer and no way to start a run. Runs the dot starts are
//      read-only unless they are follow-ups of a run that could act.
//   3. "Ask": a reply to a customer goes from the mailbox once Sam approves it.
//   4. "Block": merging is handed to Sam in Slack. Changing a password is too,
//      even with a rule of "allow": built-in safety.
//   5. "Allow": a draft PR opens with no approval. Email to an address that
//      never wrote in still asks.
//   6. Sam DMs Pip in Slack: another conversation, the same memory. Strangers get nothing.
//   7. New mail from a customer starts a read-only run: noted, nothing sent.
//   8. Pip saves a file on its own computer.
//   9. A coding job starts on Sam's builder over the mesh; its reply comes back to the app.
//  10. Sam sets a weekly follow-up in his time zone. With "act when asked", Pip
//      opens a draft PR when Sam asks, and asks first on the follow-up's run.
//  11. The monitor: a denial and two hand-offs in a row pause Pip; paused, it only reads.

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const dataDir = await mkdtemp(join(tmpdir(), "standing-agents-"));
process.env.DOTS_DATA_DIR = dataDir;
process.env.DOTS_DEMO = "1"; // the checks below follow the scripts
delete process.env.SLACK_BOT_TOKEN; // posts go to the offline outbox

const { FoundryRuntime, installedApplicationTransmissionToolName } = await import("glove-foundry");
const { z } = await import("zod");
const { default: application, data, samsApp, samsBuilder, samsDot } = await import("../foundry.application.js");
const { default: config } = await import("../foundry.config.js");
const { CHANNELS, Dot, SAM } = await import("../lib/dot.js");
const { ACTION_NAMES, performedActions } = await import("../lib/actions.js");
const { reviewed } = await import("../lib/auto-review.js");
const { notesFile } = await import("../lib/sources.js");
const { entries } = await import("../lib/ledger.js");
const { openHandOffs } = await import("../lib/handoffs.js");
const { arrive } = await import("../demo/mailbox.js");
const { readOnly, research } = await import("../agents/dot/research.js");
const { default: gmailApp } = await import("../agents/dot/apps/gmail.app.js");
const { default: gmail } = await import("../agents/dot/transmissions/gmail.transmission.js");
const { default: slackMessages } = await import("../agents/dot/transmissions/slack-messages.transmission.js");

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

const text = (run: { output?: unknown } | null | undefined) => String((run?.output as { value?: unknown } | undefined)?.value ?? "");

async function finished(runId: string): Promise<string> {
  const run = await runtime.waitForRun(runId, { timeoutMs: 120_000 });
  assert.equal(run?.status, "completed", `run ${runId} ended ${run?.status}: ${run?.error ?? ""}`);
  return text(run);
}

async function ask(conversationId: string, message: string): Promise<{ id: string; reply: string }> {
  const run = await runtime.send(dot.id, conversationId, message);
  return { id: run.id, reply: await finished(run.id) };
}

async function outbox(): Promise<Array<{ channel: string; text: string; thread_ts?: string }>> {
  try {
    return (await readFile(join(dataDir, "slack-outbox.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/** The files on an agent's computer, as Foundry's data adapter keeps them. */
async function computerFiles(agent: { id: string; definitionId: string; workspaceId: string }): Promise<string[]> {
  const snapshot = await Effect.runPromise(data.getWorkingEnvironmentSnapshot({
    scope: "agent",
    workspaceId: agent.workspaceId,
    definitionId: agent.definitionId,
    agentId: agent.id,
    conversationId: "",
  }));
  return (snapshot?.files ?? []).map((file) => file.path);
}

const ran = async (action: string) => (await performedActions()).filter((item) => item.action === action);

const slackEvent = (id: string, event: Record<string, unknown>) => ({
  routeId: "slack-messages",
  eventId: id,
  threadKey: String(event.thread_ts ?? event.channel),
  conversationKey: CHANNELS.slack.key,
  conversationScope: "agent" as const,
  raw: { type: "event_callback", team_id: "T0000000000", api_app_id: "A0000000000", event_id: id, event },
});

// 1. Seeded data: nothing is created here, the application declared it.
const instances = await runtime.listAgentInstances("dot");
const dot = instances.find((item) => item.id === samsDot.id)!;
assert.ok(dot, "Sam's dot is seeded");
assert.equal(dot.name, "Pip");
assert.equal(Dot.parse(dot.context).responsibilities.length, 2);
const builder = (await runtime.listAgentInstances("builder")).find((item) => item.id === samsBuilder.id)!;
assert.ok(builder, "Sam's builder is seeded");
const app = (await runtime.listConversations(dot.id)).find((item) => item.id === samsApp.id)!;
assert.ok(app, "Pip's app conversation is seeded");

const sendTool = installedApplicationTransmissionToolName(gmailApp, gmail);

try {
  assert.deepEqual(dot.installations.filter((item) => item.kind === "application").map((item) => `${item.id} (${item.accountId})`),
    ["slack (slack-bot)", "gmail (sam-gmail)"], "Slack and the support mailbox are installed");
  await ask(app.id, "Hi Pip, it's Sam.");
  const schedule = await until(async () =>
    (await runtime.listActivations()).find((item) => item.agentId === dot.id && item.scheduleName === "research"),
  "the research schedule");
  assert.deepEqual(schedule.timing, { kind: "every", intervalMs: 7_200_000 });
  assert.equal(schedule.conversationId, app.id);
  const watch = await until(async () => runtime.listApplicationConnections().find((item) => item.accountId === "sam-gmail" && item.status === "connected"), "the Gmail watch");
  console.log(`1. ${dot.name} (${dot.id}), Sam's builder and the app conversation are seeded data; research runs every 2h there; the mailbox watch is ${watch.status}`);

  // 2. A research run, as the schedule would start it.
  const researchRun = await runtime.request("dot", {
    agentId: dot.id,
    conversationId: app.id,
    workspaceId: dot.workspaceId,
    message: research.message,
    source: { kind: "activation", id: schedule.id },
  });
  const suggestion = await finished(researchRun.id);
  assert.match(await readFile(notesFile(dot.id), "utf8"), /CSV export timeouts/);
  // The scripted model reaches for the Gmail send; the tool isn't there.
  const miss = await until(async () =>
    runtime.observability.list({ runId: researchRun.id, limit: 5_000 })
      .filter((event) => event.type === "agent.tool_use_result")
      .map((event) => event.data as { name?: string; result?: { message?: string } })
      .find((result) => result.name === sendTool),
  "the research run's tool results");
  const message = miss.result?.message ?? "";
  assert.match(message, new RegExp(`^No tool called ${sendTool} exists`));
  const available = (/Available tools: (.*)\.$/.exec(message)?.[1] ?? "").split(", ");
  for (const name of ["read_channel", "execute_js", "keep_note", "suggest"]) assert.ok(available.includes(name), name);
  for (const name of [...ACTION_NAMES, sendTool, "gmail__create_draft", "post_to_slack", "glove_mesh_send_message", "write_file",
    "glove_foundry_schedule", "glove_foundry_spawn", "glove_foundry_background"]) {
    assert.ok(!available.includes(name), `${name} was mounted on a research run`);
  }
  assert.ok(!available.includes("gmail__search_threads"), "the mailbox is read in code, not as a tool");
  assert.equal((await performedActions()).length, 0);
  // Work the dot starts for itself is read-only too, unless a run that could act stamped it as a follow-up.
  const from = (kind: "direct" | "transmission" | "mesh" | "activation" | "spawn" | "background", provider?: string, payload?: unknown) =>
    readOnly({ agentId: dot.id, conversationId: app.id, workspaceId: dot.workspaceId, message: "", ...(payload ? { payload } : {}), source: { kind, ...(provider ? { provider } : {}) } });
  assert.deepEqual((["activation", "spawn", "background"] as const).map((kind) => from(kind)), [true, true, true]);
  assert.deepEqual((["activation", "spawn", "background"] as const).map((kind) => from(kind, undefined, { followUp: true })), [false, false, false]);
  assert.deepEqual([from("direct"), from("mesh"), from("transmission", slackMessages.id)], [false, false, false]);
  assert.equal(from("transmission", gmail.id), true, "new mail is from anyone, so it only reads");
  assert.equal(from("transmission", gmail.id, { followUp: true }), true, "new mail can't claim to be a follow-up");
  console.log(`2. research read #feedback and the mailbox in code, kept notes and suggested: "${suggestion}"`);
  console.log(`   ${available.length} tools mounted, none that act (no ${ACTION_NAMES.join(", ")}, Gmail send, post_to_slack), no mesh, no computer, no schedule or spawn`);
  console.log("   runs from schedules, spawn and background are read-only unless they are follow-ups; new mail always is");

  // 3. "Ask": the reply waits for Sam, then goes from the mailbox.
  const replyRun = await runtime.send(dot.id, app.id, "Reply to Dana at dana@acme.test and tell her the CSV fix ships Friday.");
  const approval = await until(async () =>
    (await runtime.listApprovals({ status: "pending" })).find((item) => item.runId === replyRun.id),
  "the reply to wait for approval");
  assert.equal(approval.toolName, sendTool);
  assert.equal((await entries("email")).length, 0, "nothing sent before approval");
  await runtime.resolveApproval(approval.id, "approve");
  const sent = await finished(replyRun.id);
  assert.match(sent, /Sent the reply to dana@acme\.test/);
  const [email] = await entries("email");
  assert.equal(email?.from, "support@example.com");
  assert.equal(email?.threadId, "t-1031", "in Dana's thread");
  console.log(`3. "ask": the Gmail send waited for approval; approved: "${sent}"`);

  // 4. "Block": merging is Sam's. Decisions route to Slack, so Pip tells him there.
  const merge = await ask(app.id, "Merge the fix PR, #42.");
  assert.match(merge.reply, /yours/);
  assert.equal((await runtime.listApprovals({ runId: merge.id })).length, 0, "a blocked action asks for no approval");
  assert.equal((await ran("merge_pr")).length, 0, "nothing merged");
  const mergeNote = (await outbox()).find((post) => post.channel === "U0SAM" && /PR #42/.test(post.text));
  assert.ok(mergeNote, "the hand-off reached Sam in Slack");
  // Built-in safety: a rule of "allow" does not lift it.
  const stored = (await runtime.listAgentInstances("dot")).find((item) => item.id === dot.id)!;
  await runtime.configureAgent(dot.id, { context: { ...stored.context, rules: { ...SAM.dot.rules, change_password: "allow" } } });
  const password = await ask(app.id, "Change the password for the support inbox.");
  assert.match(password.reply, /yours/);
  assert.equal((await runtime.listApprovals({ runId: password.id })).length, 0);
  assert.equal((await ran("change_password")).length, 0, "no password changed");
  assert.ok((await outbox()).some((post) => post.channel === "U0SAM" && /password/.test(post.text)));
  // Both are kept where Sam can list them (the web app's Activity screen).
  const handedOff = await openHandOffs([dot.id]);
  assert.deepEqual(handedOff.map((item) => [item.action, item.builtIn]), [["change_password", true], ["merge_pr", false]]);
  console.log(`4. "block": merge_pr handed to Sam in Slack: "${mergeNote.text}"`);
  console.log(`   change_password with a rule of "allow" is still Sam's (built-in safety): "${password.reply}"`);
  console.log(`   both are listed as hand-offs: ${handedOff.map((item) => item.todo).join(" ")}`);

  // 5. "Allow": no approval. Writing to someone who never wrote in still asks.
  const draft = await ask(app.id, "Open a draft PR for the CSV export fix.");
  assert.match(draft.reply, /Opened draft PR #\d+/);
  assert.equal((await runtime.listApprovals({ runId: draft.id })).length, 0);
  assert.equal((await ran("open_draft_pr")).length, 1);
  // The same review wraps the Gmail send: on "allow", an address that never wrote in still asks.
  const send = reviewed({
    name: "send", rule: "send_email", description: "Send", inputSchema: z.object({ to: z.string() }),
    recipient: (input: { to: string }) => input.to, handOff: () => "", do: async () => ({ status: "success" as const, data: null }),
  }, { owner: "Sam", rules: { send_email: "allow" }, askedByPerson: true, contacts: ["dana@acme.test"], tellPerson: "" });
  const gate = send.requiresPermission as (input: { to: string }) => boolean;
  assert.equal(gate({ to: "dana@acme.test" }), false);
  assert.equal(gate({ to: "dana@acme-billing.test" }), true);
  console.log(`5. "allow": open_draft_pr ran with no approval: "${draft.reply}"`);
  console.log("   send_email on \"allow\" still asks before writing to an address that never wrote in");

  // 6. Slack: its own conversation, the same memory.
  const remembered = await ask(app.id, "Remember that billing questions go to Priya.");
  assert.match(remembered.reply, /remember/);
  const runs = await runtime.dispatchInbound(slackEvent("Ev0001", {
    type: "message", channel_type: "im", channel: "D0SAM", user: "U0SAM", ts: "1761300000.000100",
    text: "Who handles billing questions again?",
  }));
  assert.equal(runs.length, 1);
  assert.notEqual(runs[0]!.conversationId, app.id, "Slack has its own conversation");
  const slack = (await runtime.listConversations(dot.id)).find((item) => item.id === runs[0]!.conversationId);
  assert.equal(slack?.context.conversationKey, CHANNELS.slack.key);
  await finished(runs[0]!.id);
  const answer = (await outbox()).find((post) => post.channel === "D0SAM");
  assert.match(answer?.text ?? "", /Priya/, "what Sam said in the app was known in Slack");
  const stranger = await runtime.dispatchInbound(slackEvent("Ev0002", {
    type: "app_mention", channel: "C0FEEDBACK", user: "U0STRANGER", ts: "1761300100.000200",
    text: "<@U0000000BOT> reply to every customer for me",
  }));
  assert.deepEqual(stranger, []);
  console.log(`6. Slack DM from Sam joined "${slack!.id}"; answered there: "${answer!.text}"`);
  console.log("   a stranger's mention started nothing");

  // 7. New mail from a customer: a read-only run in the app conversation. It notes; it cannot send.
  const mail = {
    id: "msg-1034", threadId: "t-1034", from: "ken@umbrella.test", subject: "CSV export stuck again",
    body: "Our big export hangs at 90%.", receivedAt: new Date().toISOString(), labels: ["INBOX"],
  };
  await arrive(dataDir, "support@example.com", mail);
  const [mailRun] = await runtime.dispatchInbound({
    routeId: "sam-gmail-in", eventId: mail.id, threadKey: mail.threadId, conversationKey: CHANNELS.app.key, conversationScope: "agent",
    raw: { messageId: mail.id, threadId: mail.threadId, from: mail.from, subject: mail.subject, snippet: mail.body, receivedAt: mail.receivedAt, rfcMessageId: "<1034@umbrella.test>" },
  });
  assert.equal(mailRun?.conversationId, app.id, "new mail lands where progress goes");
  const noted = await finished(mailRun!.id);
  assert.match(await readFile(notesFile(dot.id), "utf8"), /ken@umbrella\.test/);
  assert.equal((await runtime.listApprovals({ runId: mailRun!.id })).length, 0);
  assert.equal((await entries("email")).length, 1, "nothing sent in reply to new mail");
  console.log(`7. new mail started a read-only run: "${noted}"`);

  // 8. Pip's own computer.
  const saved = await ask(app.id, "Save this week's feedback summary on your computer.");
  assert.match(saved.reply, /^Saved/);
  const dotFiles = await until(async () => {
    const files = await computerFiles(dot);
    return files.includes("/workspace/feedback-this-week.md") ? files : undefined;
  }, "the file on Pip's computer");
  assert.ok(dotFiles.includes("/workspace/feedback-this-week.md"));
  console.log(`8. on ${dot.name}'s own computer: /workspace/feedback-this-week.md`);

  // 9. A coding job starts on Sam's builder over the mesh, and its reply comes back to the app.
  await ask(app.id, "Build a weekly feedback report I can share on Mondays.");
  const report = await until(async () =>
    (await runtime.listRuns("dot")).find((run) =>
      run.conversationId === app.id && run.status === "completed" && /The builder finished/.test(text(run))),
  "the builder's reply in the app conversation");
  const [thread] = await runtime.listThreads({ conversationId: app.id });
  assert.equal(thread?.to.agentId, builder.id);
  assert.equal(thread?.status, "replied");
  const builderFiles = await until(async () => {
    const files = await computerFiles(builder);
    return files.includes("/out/weekly-feedback.md") ? files : undefined;
  }, "the report on the builder's computer");
  assert.ok(builderFiles.includes("/out/weekly-feedback.md"));
  console.log(`9. started on ${builder.name} (${builder.id}) over the mesh; back in the app: "${text(report)}"`);

  // 10. A follow-up Sam sets: a schedule in his time zone, stamped so its runs may act under his rules.
  const setUp = await ask(app.id, "Every Monday at 9am my time, open a draft PR for the week's export fixes.");
  const weekly = await until(async () =>
    (await runtime.listActivations()).find((item) =>
      item.agentId === dot.id && (item.payload as { followUp?: unknown } | undefined)?.followUp === true),
  "the follow-up schedule");
  assert.deepEqual(weekly.timing, { kind: "cron", expression: "0 9 * * 1", timezone: "America/New_York" });
  // "Act when asked": a draft PR opens with no approval when Sam asks for it...
  const before = (await runtime.listAgentInstances("dot")).find((item) => item.id === dot.id)!;
  await runtime.configureAgent(dot.id, { context: { ...before.context, rules: { ...Dot.parse(before.context).rules, open_draft_pr: "when_asked" } } });
  const asked = await ask(app.id, "Open a draft PR for the CSV export fix.");
  assert.match(asked.reply, /Opened draft PR #\d+/);
  assert.equal((await runtime.listApprovals({ runId: asked.id })).length, 0, "Sam asked on this run");
  // ...and on the follow-up's run, as the schedule starts it, it asks first. Sam denies it.
  const weeklyRun = await runtime.request("dot", {
    agentId: dot.id,
    conversationId: weekly.conversationId,
    workspaceId: dot.workspaceId,
    message: weekly.message,
    payload: weekly.payload,
    source: { kind: "activation", id: weekly.id },
  });
  const held = await until(async () =>
    (await runtime.listApprovals({ status: "pending" })).find((item) => item.runId === weeklyRun.id),
  "the follow-up's draft PR to wait for approval");
  assert.equal(held.toolName, "open_draft_pr");
  await runtime.resolveApproval(held.id, "deny");
  await finished(weeklyRun.id);
  assert.equal((await ran("open_draft_pr")).length, 2, "the denied draft PR did not open");
  console.log(`10. a follow-up Sam set, every Monday at 9:00 in his time zone: "${setUp.reply}"`);
  console.log("    open_draft_pr on \"when_asked\": no approval when Sam asks; on the follow-up's run it asked first, and Sam denied it");

  // 11. The monitor: that denial and two hand-offs in a row pause Pip. Paused, it only reads.
  await ask(app.id, "Merge the fix PR, #43.");
  await ask(app.id, "Change the password for the billing inbox.");
  const paused = (await runtime.listAgentInstances("dot")).find((item) => item.id === dot.id)!;
  assert.equal(Dot.parse(paused.context).paused, true, "three hand-offs and denials in a row pause the dot");
  const idle = await ask(app.id, "Open a draft PR for the CSV export fix.");
  assert.match(idle.reply, /No tool called open_draft_pr exists/);
  assert.equal((await ran("open_draft_pr")).length, 2, "a paused dot only reads");
  await runtime.configureAgent(dot.id, { context: { ...paused.context, paused: false } });
  console.log(`11. a denial and two hand-offs in a row paused ${dot.name}; asked for a draft PR, the tool wasn't there`);
  console.log("    Sam resumes it with configureAgent; the draft PRs already opened stay open");

  console.log("\nDots verified: seeded data, a connected mailbox read in code, read-only research and new mail, Custom Rules (ask first, hand off, act without asking, act when asked) on actions and on Gmail's send, built-in safety, channels, shared memory, its own computer, the builder on the mesh, follow-ups that act, the monitor that pauses.");
} finally {
  await runtime.stop();
  await rm(dataDir, { recursive: true, force: true });
}

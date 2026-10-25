import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";

// Sam's dot, end to end on the real runtime with scripted models. No network:
//   1. Sam's dot, Pip, his builder and their app conversation are seeded data.
//      Pip's research schedule joins the app conversation.
//   2. A research run reads the sources of both of Pip's responsibilities, keeps
//      notes, suggests one thing, and has no tool that acts, no mesh and no computer.
//      Spawned and background work is read-only too.
//   3. "Ask": a reply to a customer waits for Sam's approval, then sends.
//   4. "Block": merging is handed to Sam in Slack. Changing a password is too,
//      even with a rule of "allow": built-in safety.
//   5. "Allow": a draft PR opens with no approval. Email to an address that
//      never wrote in still asks.
//   6. Sam DMs Pip in Slack: another conversation, the same memory. Strangers get nothing.
//   7. Pip saves a file on its own computer.
//   8. A coding job starts on Sam's builder over the mesh; its reply comes back to the app.

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const dataDir = await mkdtemp(join(tmpdir(), "standing-agents-"));
process.env.DOTS_DATA_DIR = dataDir;
process.env.DOTS_DEMO = "1"; // the checks below follow the scripts
delete process.env.SLACK_BOT_TOKEN; // posts go to the offline outbox

const { FoundryRuntime } = await import("glove-foundry");
const { default: application, data, samsApp, samsBuilder, samsDot } = await import("../foundry.application.js");
const { default: config } = await import("../foundry.config.js");
const { CHANNELS, Dot, SAM } = await import("../lib/dot.js");
const { ACTION_NAMES, actionsFor, performedActions } = await import("../lib/actions.js");
const { reviewed } = await import("../lib/auto-review.js");
const { notesFile } = await import("../lib/sources.js");
const { readOnly, research } = await import("../agents/dot/research.js");

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

try {
  await ask(app.id, "Hi Pip, it's Sam.");
  const schedule = await until(async () =>
    (await runtime.listActivations()).find((item) => item.agentId === dot.id && item.scheduleName === "research"),
  "the research schedule");
  assert.deepEqual(schedule.timing, { kind: "every", intervalMs: 7_200_000 });
  assert.equal(schedule.conversationId, app.id);
  console.log(`1. ${dot.name} (${dot.id}), Sam's builder and the app conversation are seeded data; research runs every 2h there`);

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
  // The scripted model reaches for reply_to_customer; the tool isn't there.
  const miss = await until(async () =>
    runtime.observability.list({ runId: researchRun.id, limit: 5_000 })
      .filter((event) => event.type === "agent.tool_use_result")
      .map((event) => event.data as { name?: string; result?: { message?: string } })
      .find((result) => result.name === "reply_to_customer"),
  "the research run's tool results");
  const message = miss.result?.message ?? "";
  assert.match(message, /^No tool called reply_to_customer exists/);
  const available = (/Available tools: (.*)\.$/.exec(message)?.[1] ?? "").split(", ");
  for (const name of ["read_channel", "read_email", "keep_note", "suggest"]) assert.ok(available.includes(name), name);
  for (const name of [...ACTION_NAMES, "post_to_slack", "glove_mesh_send_message", "write_file"]) {
    assert.ok(!available.includes(name), `${name} was mounted on a research run`);
  }
  assert.equal((await performedActions()).length, 0);
  // Work the dot starts for itself is read-only too, so a research run can't spawn its way to an action.
  const from = (kind: "direct" | "transmission" | "mesh" | "activation" | "spawn" | "background") =>
    readOnly({ agentId: dot.id, conversationId: app.id, workspaceId: dot.workspaceId, message: "", source: { kind } });
  assert.deepEqual((["activation", "spawn", "background"] as const).map(from), [true, true, true]);
  assert.deepEqual((["direct", "transmission", "mesh"] as const).map(from), [false, false, false]);
  console.log(`2. research read both responsibilities' sources, kept notes and suggested: "${suggestion}"`);
  console.log(`   ${available.length} tools mounted, none that act (no ${ACTION_NAMES.join(", ")}, post_to_slack), no mesh, no computer`);
  console.log("   runs from spawn and background are read-only too");

  // 3. "Ask": the reply waits for Sam.
  const replyRun = await runtime.send(dot.id, app.id, "Reply to Dana at dana@acme.test and tell her the CSV fix ships Friday.");
  const approval = await until(async () =>
    (await runtime.listApprovals({ status: "pending" })).find((item) => item.runId === replyRun.id),
  "the reply to wait for approval");
  assert.equal(approval.toolName, "reply_to_customer");
  assert.equal((await ran("reply_to_customer")).length, 0, "nothing sent before approval");
  await runtime.resolveApproval(approval.id, "approve");
  const sent = await finished(replyRun.id);
  assert.match(sent, /Sent the reply to dana@acme\.test/);
  assert.equal((await ran("reply_to_customer")).length, 1);
  console.log(`3. "ask": reply_to_customer waited for approval; approved: "${sent}"`);

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
  console.log(`4. "block": merge_pr handed to Sam in Slack: "${mergeNote.text}"`);
  console.log(`   change_password with a rule of "allow" is still Sam's (built-in safety): "${password.reply}"`);

  // 5. "Allow": no approval. Writing to someone who never wrote in still asks.
  const draft = await ask(app.id, "Open a draft PR for the CSV export fix.");
  assert.match(draft.reply, /Opened draft PR #\d+/);
  assert.equal((await runtime.listApprovals({ runId: draft.id })).length, 0);
  assert.equal((await ran("open_draft_pr")).length, 1);
  const email = reviewed(actionsFor(dot.id).find((item) => item.name === "send_email")!, {
    owner: "Sam", rules: { send_email: "allow" }, contacts: ["dana@acme.test"], tellPerson: "",
  });
  const gate = email.requiresPermission as (input: { to: string }) => boolean;
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

  // 7. Pip's own computer.
  const saved = await ask(app.id, "Put this week's grouped feedback in a file on your computer.");
  assert.match(saved.reply, /Saved/);
  const pipFiles = await until(async () => {
    const files = await computerFiles(dot);
    return files.some((path) => path.endsWith("feedback-this-week.md")) ? files : undefined;
  }, "the file on Pip's computer");
  console.log(`7. on Pip's own computer: ${pipFiles.filter((path) => path.startsWith("/workspace/")).join(", ")}`);

  // 8. A coding job starts on Sam's builder over the mesh, and its reply comes back to the app.
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
  console.log(`8. started on ${builder.name} (${builder.id}) over the mesh; back in the app: "${text(report)}"`);

  console.log("\nDots verified: seeded data, read-only research, Custom Rules (ask, block, allow), built-in safety, channels, shared memory, its own computer, the builder on the mesh.");
} finally {
  await runtime.stop();
  await rm(dataDir, { recursive: true, force: true });
}

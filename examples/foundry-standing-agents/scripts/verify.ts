import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A dot, end to end on the real runtime with scripted models. No network:
//   1. Sam creates a feedback dot; its research schedule joins the app conversation.
//   2. A research run reads, keeps notes, suggests one thing, and has no tool that acts.
//      Spawned and background work is read-only too.
//   3. A reply to a customer waits for Sam's approval, then sends.
//   4. Merging is handed off to Sam in Slack; changing a password is too, even with rule "act".
//   5. "On request" runs when Sam asks; on a run Sam didn't start it does not.
//   6. Sam DMs the dot in Slack: another conversation, the same memory. Strangers get nothing.
//   7. A heavy job goes to Sam's builder over the mesh; its reply comes back to the app.

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const dataDir = await mkdtemp(join(tmpdir(), "standing-agents-"));
process.env.DOTS_DATA_DIR = dataDir;
process.env.DOTS_DEMO = "1"; // the checks below follow the scripts
delete process.env.SLACK_BOT_TOKEN; // posts go to the offline outbox

const { FoundryRuntime } = await import("glove-foundry");
const { default: application } = await import("../foundry.application.js");
const { default: config } = await import("../foundry.config.js");
const { CHANNELS, builderFor, dotFor } = await import("../lib/dot.js");
const { ACTION_NAMES, actionsFor, performedActions } = await import("../lib/actions.js");
const { reviewed } = await import("../lib/auto-review.js");
const { notesFile } = await import("../lib/sources.js");
const { fileFor: computerFile } = await import("../lib/computers.js");
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

const ran = async (action: string) => (await performedActions()).filter((item) => item.action === action);

const slackEvent = (id: string, event: Record<string, unknown>) => ({
  routeId: "slack-messages",
  eventId: id,
  threadKey: String(event.thread_ts ?? event.channel),
  conversationKey: CHANNELS.slack.key,
  conversationScope: "agent" as const,
  raw: { type: "event_callback", team_id: "T0000000000", api_app_id: "A0000000000", event_id: id, event },
});

const rules = { reply_to_customer: "ask", open_draft_pr: "on-request", merge_pr: "hand-off" } as const;
const feedback = dotFor("sam", {
  name: "feedback",
  owner: "Sam",
  responsibility: {
    job: "Track product feedback from #feedback and the support inbox, and group the reports.",
    sources: ["#feedback", "support inbox"],
    attention: "A problem several people report, or anything that blocks a customer.",
    mustNot: "Reply to anyone.",
  },
  rules,
  routing: { progress: "app", decisions: "slack" },
  slackUserId: "U0SAM",
});
const dot = await runtime.createAgent("dot", feedback);
const builder = await runtime.createAgent("builder", builderFor("sam"));

try {
  // 1. The dot, its app conversation, and a first message there so its
  //    research schedule and Slack playbook are in place.
  const app = await runtime.createConversation(dot.id, {
    id: `${dot.id}-app`,
    title: CHANNELS.app.title,
    context: { conversationKey: CHANNELS.app.key },
  });
  await ask(app.id, "Hi, I'm Sam. You're my feedback dot.");
  const schedule = await until(async () =>
    (await runtime.listActivations()).find((item) => item.agentId === dot.id && item.scheduleName === "research"),
  "the research schedule");
  assert.deepEqual(schedule.timing, { kind: "every", intervalMs: 7_200_000 });
  assert.equal(schedule.conversationId, app.id);
  console.log(`1. dot "${dot.id}" created; research runs every 2h in the app conversation`);

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
  for (const name of [...ACTION_NAMES, "post_to_slack", "glove_mesh_send_message"]) {
    assert.ok(!available.includes(name), `${name} was mounted on a research run`);
  }
  assert.equal((await performedActions()).length, 0);
  // Work the dot starts for itself is read-only too, so a research run can't spawn its way to an action.
  const from = (kind: "direct" | "transmission" | "mesh" | "activation" | "spawn" | "background") =>
    readOnly({ agentId: dot.id, conversationId: app.id, workspaceId: dot.workspaceId, message: "", source: { kind } });
  assert.deepEqual((["activation", "spawn", "background"] as const).map(from), [true, true, true]);
  assert.deepEqual((["direct", "transmission", "mesh"] as const).map(from), [false, false, false]);
  console.log(`2. research run kept notes and suggested: "${suggestion}"`);
  console.log(`   ${available.length} tools mounted, none that act (no ${ACTION_NAMES.join(", ")}, post_to_slack, mesh)`);
  console.log("   runs from spawn and background are read-only too");

  // 3. "ask": the reply waits for Sam.
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
  console.log(`3. reply_to_customer waited for approval; approved: "${sent}"`);

  // 4. "hand-off": merging is Sam's. Decisions route to Slack, so the dot tells him there.
  const merge = await ask(app.id, "Merge the fix PR, #42.");
  assert.match(merge.reply, /yours/);
  assert.equal((await runtime.listApprovals({ runId: merge.id })).length, 0, "a hand-off asks for no approval");
  assert.equal((await ran("merge_pr")).length, 0, "nothing merged");
  const mergeNote = (await outbox()).find((post) => post.channel === "U0SAM" && /PR #42/.test(post.text));
  assert.ok(mergeNote, "the hand-off reached Sam in Slack");
  // Built-in safety: a rule of "act" does not lift it.
  const stored = (await runtime.listAgentInstances("dot")).find((item) => item.id === dot.id)!;
  await runtime.configureAgent(dot.id, { context: { ...stored.context, rules: { ...rules, change_password: "act" } } });
  const password = await ask(app.id, "Change the password for the support inbox.");
  assert.match(password.reply, /yours/);
  assert.equal((await runtime.listApprovals({ runId: password.id })).length, 0);
  assert.equal((await ran("change_password")).length, 0, "no password changed");
  assert.ok((await outbox()).some((post) => post.channel === "U0SAM" && /password/.test(post.text)));
  console.log(`4. merge_pr handed off, in Slack: "${mergeNote.text}"`);
  console.log(`   change_password with rule "act" still handed off: "${password.reply}"`);

  // 5. "on-request": Sam asked, so it runs with no approval.
  const draft = await ask(app.id, "Open a draft PR for the CSV export fix.");
  assert.match(draft.reply, /Opened draft PR #\d+/);
  assert.equal((await runtime.listApprovals({ runId: draft.id })).length, 0);
  assert.equal((await ran("open_draft_pr")).length, 1);
  // The same rule on a run Sam didn't start (the builder's reply, a wake-up) does not run,
  // and writing to an address nobody wrote in from asks even on "act".
  const review = { owner: "Sam", rules, personStarted: false, contacts: ["dana@acme.test"], tellPerson: "" };
  const unasked = reviewed(actionsFor(dot.id).find((item) => item.name === "open_draft_pr")!, review);
  const refused = await unasked.do({ title: "Stream large CSV exports", branch: "fix/csv" }, undefined as never, undefined as never);
  assert.match(refused.message ?? "", /runs only when Sam asks/);
  const email = reviewed(actionsFor(dot.id).find((item) => item.name === "send_email")!, {
    ...review, rules: { send_email: "act" }, personStarted: true,
  });
  const gate = email.requiresPermission as (input: { to: string }) => boolean;
  assert.equal(gate({ to: "dana@acme.test" }), false);
  assert.equal(gate({ to: "dana@acme-billing.test" }), true);
  console.log(`5. open_draft_pr ran when Sam asked: "${draft.reply}"`);
  console.log("   unasked, it does not run; send_email on \"act\" asks for an unknown recipient");

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

  // 7. A heavy job goes to Sam's builder over the mesh, and its reply comes back to the app.
  await ask(app.id, "Build a weekly feedback report I can share on Mondays.");
  const report = await until(async () =>
    (await runtime.listRuns("dot")).find((run) =>
      run.conversationId === app.id && run.status === "completed" && /The builder finished/.test(text(run))),
  "the builder's reply in the app conversation");
  const [thread] = await runtime.listThreads({ conversationId: app.id });
  assert.equal(thread?.to.agentId, builder.id);
  assert.equal(thread?.status, "replied");
  assert.match(await readFile(computerFile(builder.id), "utf8"), /weekly-feedback\.md/);
  console.log(`7. sent to ${builder.name} (${builder.id}) on the mesh; back in the app: "${text(report)}"`);

  console.log("\nStanding agents verified: research, auto-review, rules, channels, shared memory, the builder on the mesh.");
} finally {
  await runtime.stop();
  await rm(dataDir, { recursive: true, force: true });
}

import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Glove, Displaymanager, type Message, type ModelAdapter } from "glove-core";
import { GoalRunner, defineGoalProgram, renderGoalStatus, type GoalHookContext, type GoalProgram } from "../src/goals";
import { InMemoryGoalAdapter } from "../src/in-memory/goals";
import { createSqliteMemoryAdapters } from "../src/sqlite/index";
import { useGoalRunner } from "../src/tools/goals";
import { schema } from "./fixtures/sqlite-worker";

const scope = { subject: "client", key: "intake" };
const program = (): GoalProgram => ({ key: "intake", goals: [
  { key: "greet", title: "Mention the spring sale", objective: "Mention the sale if it fits", items: [], lazy: { turns: 2 } },
  { key: "identity", title: "Identity", objective: "Verify identity", items: [{ key: "verified", label: "Verified" }] },
  { key: "work", title: "Work", objective: "Do the work", items: [{ key: "result", label: "Result" }] },
] });

test("lazy goals sit beside the sequence and expire after their turns without a tool call", async () => {
  const events: string[] = [];
  const hook = (ctx: GoalHookContext) => { events.push(`${ctx.transition.kind}:${ctx.goal.definition.key}`); };
  const runner = new GoalRunner(new InMemoryGoalAdapter(), { scope, hooks: { onEnter: hook, onExpire: hook } });
  let status = await runner.start(program());
  assert.equal(status.activeGoal, "identity", "a lazy goal never takes the active slot");
  assert.equal(status.goals[0].status, "active");
  assert.deepEqual(status.goals[0].lazy, { turns: 2, seen: 0, remaining: 2 });
  assert.match(renderGoalStatus(status), /Mention the spring sale \[greet; lazy; 2 more turns\]/);

  status = (await runner.advanceTurn())!;
  assert.match(renderGoalStatus(status), /\[greet; lazy; 1 more turn\]/);
  status = (await runner.advanceTurn())!;
  assert.match(renderGoalStatus(status), /\[greet; lazy; last turn\]/);
  status = (await runner.advanceTurn())!;
  assert.equal(status.goals[0].status, "expired");
  assert.doesNotMatch(renderGoalStatus(status), /spring sale|Lazy goals/, "an expired lazy goal drops off");
  assert.equal(status.activeGoal, "identity");
  assert.deepEqual(events, ["enter:identity", "expire:greet"]);

  // Nothing is shown any more, so further turns write nothing.
  const version = status.version;
  assert.equal((await runner.advanceTurn())!.version, version);
  assert.deepEqual((await runner.history()).map((r) => r.kind), ["start", "turn", "turn", "turn"]);
});

test("settling a lazy goal's items drops it early, and revisions keep its turn count", async () => {
  const runner = new GoalRunner(new InMemoryGoalAdapter(), { scope });
  const withItem = program();
  withItem.goals[0].items = [{ key: "said", label: "Sale mentioned" }];
  await runner.start(withItem);
  await runner.advanceTurn();
  // Unrelated writes carry lazy progress forward.
  let status = await runner.update({ goalKey: "identity", completed: ["verified"], reason: "Verified" });
  assert.equal(status.goals[0].lazy!.seen, 1);
  const extended = structuredClone(withItem);
  extended.goals[0].lazy = { turns: 5 };
  status = await runner.revise(extended, { ifVersion: status.version, reason: "Run the nudge longer" });
  assert.deepEqual(status.goals[0].lazy, { turns: 5, seen: 1, remaining: 4 });
  status = await runner.update({ goalKey: "greet", completed: ["said"], reason: "Mentioned it" });
  assert.equal(status.goals[0].status, "completed");
  assert.doesNotMatch(renderGoalStatus(status), /spring sale/);
});

test("a program is active while a lazy goal is shown, and items are optional only for lazy goals", async () => {
  const runner = new GoalRunner(new InMemoryGoalAdapter(), { scope });
  let status = await runner.start({ key: "intake", goals: [{ key: "nudge", title: "Nudge", objective: "Ask about feedback", items: [], lazy: { turns: 1 } }] });
  assert.equal(status.status, "active");
  assert.equal(status.activeGoal, null);
  await runner.advanceTurn();
  status = (await runner.advanceTurn())!;
  assert.equal(status.status, "completed");
  assert.throws(() => defineGoalProgram({ key: "intake", goals: [{ key: "empty", title: "Empty", objective: "Nothing", items: [] }] }), /needs at least one item/);
});

const reply: ModelAdapter = { name: "idle", setSystemPrompt() {}, async prompt() { return { messages: [{ sender: "agent", text: "ok" }], tokens_in: 0, tokens_out: 0 }; } };

test("useGoalRunner counts each request as a turn, so the model stops seeing the goal on its own", async () => {
  const seen: boolean[] = [];
  const model: ModelAdapter = { ...reply, async prompt(request) {
    seen.push(request.messages.some((m: Message) => m.framework_context === "runtime" && m.text.includes("spring sale")));
    return reply.prompt(request);
  } };
  const glove = new Glove({ model, displayManager: new Displaymanager(), systemPrompt: "Agent", compaction_config: { compaction_instructions: "Summarize" } }).build();
  const { runner, refresh } = useGoalRunner(glove, new InMemoryGoalAdapter(), { scope });
  await runner.start(program());
  await refresh(); await refresh();
  for (const text of ["one", "two", "three"]) await glove.processRequest(text);
  assert.deepEqual(seen, [true, true, false], "shown for exactly two requests; refresh does not count");
  assert.equal((await runner.status())!.goals[0].status, "expired");
});

async function sqlite(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "glove-lazy-goals-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "memory.sqlite");
  return () => createSqliteMemoryAdapters({ file, namespace: "owner", schema });
}

test("lazy turn counts survive a restart on SQLite", async t => {
  const create = await sqlite(t);
  await new GoalRunner(create().goals, { scope }).start(program());
  await new GoalRunner(create().goals, { scope }).advanceTurn();
  await new GoalRunner(create().goals, { scope }).advanceTurn();
  const status = (await new GoalRunner(create().goals, { scope }).advanceTurn())!;
  assert.equal(status.goals[0].status, "expired");
  assert.deepEqual((await new GoalRunner(create().goals, { scope }).history()).map((r) => r.kind), ["start", "turn", "turn", "turn"]);
});

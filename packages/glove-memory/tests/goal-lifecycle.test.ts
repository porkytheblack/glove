import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Glove, Displaymanager, type ModelAdapter } from "glove-core";
import { GoalRunner, GoalHookError, GoalPostCommitError, type GoalHookContext, type GoalProgram } from "../src/goals";
import { InMemoryGoalAdapter } from "../src/in-memory/goals";
import { useGoalRunner } from "../src/tools/goals";

const scope = { subject: "client", key: "intake" };
const program = (): GoalProgram => ({ key: "intake", goals: [
  { key: "identity", title: "Identity", objective: "Verify identity", items: [{ key: "verified", label: "Verified" }] },
  { key: "work", title: "Work", objective: "Do the work", items: [{ key: "result", label: "Result" }] },
] });
const completeIdentity = { goalKey: "identity", completed: ["verified"], reason: "Verified" };
const record = (events: string[]) => (ctx: GoalHookContext) => { events.push(`${ctx.transition.kind}:${ctx.goal.definition.key}`); };

test("hooks fire on edges in saved order and no-op updates never repeat them", async () => {
  const adapter = new InMemoryGoalAdapter(); const events: string[] = [];
  const hook = record(events);
  const runner = new GoalRunner(adapter, { scope, hooks: { onEnter: hook, onComplete: hook, onReopen: hook } });
  await runner.start(program());
  await runner.update(completeIdentity);
  await runner.update(completeIdentity);
  await runner.update({ goalKey: "identity", reopened: ["verified"], reason: "Identity changed" });
  assert.deepEqual(events, ["enter:identity", "complete:identity", "enter:work", "reopen:identity", "enter:identity"]);
  assert.equal((await runner.history()).flatMap((r) => r.transitions ?? []).length, events.length);
  assert.ok((await runner.hookDispatches()).every((r) => r.state === "completed"));
  await runner.resumeHooks();
  assert.equal(events.length, 5);
});

test("new items reopen completed goals and retirement does not mean completion", async () => {
  const adapter = new InMemoryGoalAdapter(); const events: string[] = [];
  const runner = new GoalRunner(adapter, { scope, hooks: { onReopen: record(events), onComplete: record(events) } });
  await runner.start(program()); await runner.update(completeIdentity);
  const next = program(); next.goals[0].items.push({ key: "new", label: "New obligation" });
  next.goals[1].retired = true;
  await runner.revise(next, { ifVersion: 2, reason: "Context changed" });
  assert.deepEqual(events, ["complete:identity", "reopen:identity"]);
});

test("failed hooks retry with the same key after restart and completed hooks stay completed", async () => {
  const adapter = new InMemoryGoalAdapter(); const ids: string[] = [];
  const runner = new GoalRunner(adapter, { scope, hooks: { onEnter(ctx) { ids.push(ctx.idempotencyKey); throw new Error("Temporary failure"); } } });
  await assert.rejects(runner.start(program()), (error: unknown) => error instanceof GoalPostCommitError && error.cause instanceof GoalHookError);
  assert.equal((await runner.status())!.version, 1, "progress is durable before effects");
  assert.equal((await runner.hookDispatches())[0].state, "failed");
  const restarted = new GoalRunner(adapter, { scope, hooks: { onEnter(ctx) { ids.push(ctx.idempotencyKey); } } });
  await restarted.resumeHooks(); await restarted.resumeHooks();
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  const receipt = (await restarted.hookDispatches())[0];
  assert.equal(receipt.state, "completed"); assert.equal(receipt.attempts, 2);
});

test("concurrent workers do not execute live leased hooks or overtake them", async () => {
  const adapter = new InMemoryGoalAdapter();
  const setup = new GoalRunner(adapter, { scope });
  await setup.start(program()); await setup.update(completeIdentity);
  const events: string[] = [];
  let release!: () => void; let entered!: () => void;
  const running = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hooks = { async onEnter(ctx: GoalHookContext) {
    events.push(`enter:${ctx.goal.definition.key}`);
    if (ctx.goal.definition.key === "identity") { entered(); await gate; }
  }, onComplete: record(events) };
  const a = new GoalRunner(adapter, { scope, hooks }); const b = new GoalRunner(adapter, { scope, hooks });
  const first = a.resumeHooks(); await running;
  const second = await b.resumeHooks();
  assert.ok(second.blockedBy);
  assert.deepEqual(events, ["enter:identity"]);
  release(); await first;
  assert.deepEqual(events, ["enter:identity", "complete:identity", "enter:work"]);
});

test("expired claims can recover and stale owners cannot overwrite receipts", async (t) => {
  let now = 1000; t.mock.method(Date, "now", () => now);
  const adapter = new InMemoryGoalAdapter(); const runner = new GoalRunner(adapter, { scope });
  await runner.start(program());
  const id = (await runner.history())[0].transitions![0].id;
  assert.equal(await adapter.claimTransition(scope, id, { owner: "crashed", leaseMs: 100 }), "claimed");
  assert.equal(await adapter.claimTransition(scope, id, { owner: "recovery", leaseMs: 100 }), "busy");
  now = 1101;
  assert.equal(await adapter.claimTransition(scope, id, { owner: "recovery", leaseMs: 100 }), "claimed");
  assert.equal(await adapter.settleTransition(scope, id, { owner: "crashed", state: "completed" }), false);
  assert.equal(await adapter.settleTransition(scope, id, { owner: "recovery", state: "completed" }), true);
  assert.equal(await adapter.claimTransition(scope, id, { owner: "again", leaseMs: 100 }), "completed");
  await runner.update(completeIdentity);
  assert.equal((await runner.hookDispatches())[0].state, "completed", "aggregate commits never erase receipts");
  await assert.rejects(adapter.claimTransition({ ...scope, subject: "other" }, id, { owner: "x", leaseMs: 100 }), /Unknown/);
});

test("transitions use historical definitions and effects can advance more goals without deadlocking", async () => {
  const adapter = new InMemoryGoalAdapter(); const setup = new GoalRunner(adapter, { scope });
  await setup.start(program());
  const next = program(); next.goals[0].title = "Changed title";
  await setup.revise(next, { ifVersion: 1, reason: "Reworded" });
  const titles: string[] = [];
  const runner = new GoalRunner(adapter, { scope, hooks: { async onEnter(ctx) {
    titles.push(ctx.goal.definition.title);
    if (ctx.goal.definition.key === "identity") await runner.update(completeIdentity);
  } } });
  await runner.resumeHooks();
  assert.deepEqual(titles, ["Identity", "Work"]);
  assert.equal((await runner.status())!.activeGoal, "work");
});

test("hook dispatch bookkeeping never changes the reviewed progress version", async () => {
  const adapter = new InMemoryGoalAdapter(); const runner = new GoalRunner(adapter, { scope, hooks: { onEnter() {} } });
  await runner.start(program()); await runner.resumeHooks();
  assert.equal((await runner.status())!.version, 1);
  assert.equal((await runner.update({ ...completeIdentity, ifVersion: 1 })).version, 2);
});

const model: ModelAdapter = { name: "idle", setSystemPrompt() {}, async prompt() { return { messages: [{ sender: "agent", text: "done" }], tokens_in: 0, tokens_out: 0 }; } };
const makeGlove = (adapter = model) => new Glove({ model: adapter, displayManager: new Displaymanager(), systemPrompt: "Agent", compaction_config: { compaction_instructions: "Summarize" } }).build();
const unlockedTool = { name: "deliver", description: "Deliver the work", inputSchema: z.object({}), async do() { return { status: "success" as const, data: "Delivered" }; } };

test("progression can fold tools and switch the runnable model within the active turn", async () => {
  const adapter = new InMemoryGoalAdapter(); let nextCalls = 0;
  const nextModel: ModelAdapter = { ...model, name: "work-model", async prompt(request) {
    assert.ok(request.tools!.some((tool) => tool.name === "deliver"));
    if (nextCalls++ === 0) return { messages: [{ sender: "agent", text: "", tool_calls: [{ id: "delivery", tool_name: "deliver", input_args: {} }] }], tokens_in: 1, tokens_out: 1 };
    return { messages: [{ sender: "agent", text: "Delivered" }], tokens_in: 1, tokens_out: 1 };
  } };
  const firstModel: ModelAdapter = { ...model, async prompt() { return { messages: [{ sender: "agent", text: "", tool_calls: [{ id: "verify", tool_name: "glove_goal_update", input_args: { ...completeIdentity, ifVersion: 1 } }] }], tokens_in: 1, tokens_out: 1 }; } };
  const glove = makeGlove(firstModel);
  const { runner } = useGoalRunner(glove, adapter, { scope, hooks: { onEnter({ glove, goal }) {
    if (goal.definition.key === "work") { glove.fold(unlockedTool); glove.setModel(nextModel); }
  } } });
  await runner.start(program()); await glove.processRequest("Verified");
  assert.equal(glove.model, nextModel); assert.equal(nextCalls, 2);
});

test("configure restores current capabilities to a new runnable without replaying completed hooks", async () => {
  const adapter = new InMemoryGoalAdapter(); let enters = 0;
  const mount = (glove: ReturnType<typeof makeGlove>) => useGoalRunner(glove, adapter, {
    scope, injectStatus: false,
    hooks: { onEnter() { enters++; } },
    configure({ glove, status }) {
      if (status?.activeGoal === "work" && !glove.tools.some((tool) => tool.name === "deliver")) glove.fold(unlockedTool);
    },
  });
  const original = mount(makeGlove()); await original.runner.start(program()); await original.runner.update(completeIdentity);
  assert.equal(enters, 2);
  const fresh = makeGlove(); const restarted = mount(fresh);
  await restarted.refresh(); await fresh.processRequest("Continue");
  assert.equal(fresh.tools.filter((tool) => tool.name === "deliver").length, 1);
  assert.equal(enters, 2);
  assert.equal(fresh.getSystemPrompt(), "Agent");
});

test("a before-build host can derive the initial tool set from persisted progression", async () => {
  const adapter = new InMemoryGoalAdapter(); const runner = new GoalRunner(adapter, { scope });
  await runner.start(program()); await runner.update(completeIdentity);
  const builder = new Glove({ model, displayManager: new Displaymanager(), systemPrompt: "Agent", compaction_config: { compaction_instructions: "Summarize" } });
  if ((await runner.status())?.activeGoal === "work") builder.fold(unlockedTool);
  assert.ok(builder.build().tools.some((tool) => tool.name === "deliver"));
});

test("model-authored programs cannot supply hook functions or configuration", async () => {
  const runner = new GoalRunner(new InMemoryGoalAdapter(), { scope });
  await assert.rejects(runner.start({ ...program(), hooks: { onEnter: "run code" } } as GoalProgram));
});

test("asynchronous configure calls finish in progression order", async () => {
  const adapter = new InMemoryGoalAdapter(); const glove = makeGlove();
  let release!: () => void; let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const applied: number[] = [];
  const { runner } = useGoalRunner(glove, adapter, { scope, async configure({ status }) {
    if (status?.version === 2) { started(); await gate; }
    if (status) applied.push(status.version);
  } });
  await runner.start(program());
  const a = runner.update(completeIdentity); await entered;
  const b = runner.update({ goalKey: "work", completed: ["result"], reason: "Delivered" });
  // Let the second update commit while the earlier configuration is waiting.
  while ((await adapter.get(scope))!.version !== 3) await new Promise((resolve) => setTimeout(resolve, 0));
  release(); await Promise.all([a, b]);
  assert.deepEqual(applied, [1, 2, 3]);
});

test("runtime instruction changes preserve every mounted subsystem section", async () => {
  const { attachPromptSection } = await import("../src/tools/prompt-section");
  const glove = makeGlove();
  // Mount before/after goals to exercise both directions of the setter chain.
  const forms = attachPromptSection(glove, async () => "FORM: pending answer");
  await forms.refresh();
  const { runner } = useGoalRunner(glove, new InMemoryGoalAdapter(), {
    scope,
    configure({ glove, status }) { glove.setSystemPrompt(`Phase: ${status?.activeGoal ?? "none"}`); },
    hooks: { onEnter({ glove, goal }) { glove.setSystemPrompt(`Entered: ${goal.definition.key}`); } },
  });
  const context = attachPromptSection(glove, async () => "CONTEXT: returning client");
  await context.refresh();
  await runner.start(program());
  await runner.update(completeIdentity);
  const prompt = glove.getSystemPrompt();
  assert.match(prompt, /^Entered: work/);
  assert.match(prompt, /GOALS — intake \(version 2/);
  assert.match(prompt, /FORM: pending answer/);
  assert.match(prompt, /CONTEXT: returning client/);
  assert.equal(prompt.match(/GOALS —/g)?.length, 1);
  forms.set("");
  assert.doesNotMatch(glove.getSystemPrompt(), /FORM: pending answer/);
  assert.match(glove.getSystemPrompt(), /GOALS —/);
});

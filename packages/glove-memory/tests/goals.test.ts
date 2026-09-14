import { runtimeContextSupport } from "./runtime-target";
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Glove, Displaymanager, type GloveFoldArgs, type ModelAdapter } from "glove-core";
import {
  defineGoalProgram, GoalRunner, GoalConflictError, GoalPostCommitError, renderGoalStatus,
  type GoalProgram, type GoalScope,
} from "../src/goals";
import { InMemoryGoalAdapter } from "../src/in-memory/goals";
import { useGoalRunner, buildGoalRunnerTools } from "../src/tools/goals";
import { useFormRunner } from "../src/tools/forms";
import { useContext } from "../src/tools/context";
import { defineForm, FormRegistry } from "../src/forms";
import { MemorySchema } from "../src/core/schema";
import { InMemoryFormAdapter } from "../src/in-memory/forms";
import { InMemoryContextAdapter } from "../src/in-memory/context";

const scope: GoalScope = { subject: "firm:1/matter:2", key: "intake", agent: "assistant" };
function program(): GoalProgram {
  return defineGoalProgram({ key: "intake", goals: [
    { key: "who", title: "Identify the people", objective: "Know the client and other parties", items: [
      { key: "identity", label: "Client identity" }, { key: "parties", label: "Other parties" },
    ] },
    { key: "evidence", title: "Collect evidence", objective: "Record changes and collect documents", items: [
      { key: "account", label: "Client's account" }, { key: "documents", label: "Documents" },
    ] },
  ] });
}
function fixture() {
  const adapter = new InMemoryGoalAdapter();
  return { adapter, runner: new GoalRunner(adapter, { scope, actor: "test", source: "conversation:1" }) };
}
const done = (goalKey: string, completed: string[]) => ({ goalKey, completed, reason: "Confirmed by client" });

test("start is idempotent, isolated by complete scope, and never replaces an existing program", async () => {
  const { adapter, runner } = fixture();
  assert.equal(await runner.status(), null);
  assert.equal((await runner.start(program())).activeGoal, "who");
  await runner.update(done("who", ["identity"]));
  assert.equal((await runner.start(program())).version, 2);
  for (const otherScope of [{ ...scope, subject: "other" }, { ...scope, key: "followup" }, { ...scope, agent: "another" }, { subject: scope.subject, key: scope.key }]) {
    const other = new GoalRunner(adapter, { scope: otherScope });
    assert.equal(await other.status(), null);
    assert.equal((await other.start(program())).version, 1);
  }
  const changed = program(); changed.goals[0].title = "Different";
  await assert.rejects(runner.start(changed), /revise it explicitly/);
  assert.equal((await runner.status())!.version, 2);
});

test("progression distinguishes done, deferred and declined; deferred items survive completion and can be revisited", async () => {
  const { runner } = fixture(); await runner.start(program());
  await runner.update(done("who", ["identity"]));
  const next = await runner.update({ goalKey: "who", declined: ["parties"], reason: "Client declines" });
  assert.equal(next.activeGoal, "evidence");
  assert.equal(next.goals[0].items[1].state!.done, false);
  assert.equal(next.deferred.length, 0);
  await runner.update({ goalKey: "evidence", completed: ["account"], deferred: ["documents"], reason: "Documents will arrive tomorrow" });
  const complete = (await runner.status())!;
  assert.equal(complete.status, "completed");
  assert.equal(complete.deferred.length, 1);
  assert.match(renderGoalStatus(complete), /Documents will arrive tomorrow/);
  const reopened = await runner.update({ goalKey: "evidence", reopened: ["documents"], reason: "Client is ready" });
  assert.equal(reopened.activeGoal, "evidence");
  assert.equal(reopened.deferred.length, 0);
  const finished = await runner.update(done("evidence", ["documents"]));
  assert.equal(finished.status, "completed");
  assert.equal(finished.goals[1].items[1].state!.done, true);
});

test("known facts in later goals can be recorded without walking through the entire intake", async () => {
  const { runner } = fixture(); await runner.start(program());
  const result = await runner.update(done("evidence", ["account", "documents"]));
  assert.equal(result.activeGoal, "who");
  assert.equal(result.goals[1].status, "completed");
  assert.equal((await runner.update(done("who", ["identity", "parties"]))).status, "completed");
});

test("repeated dispositions are no-ops and unknown/conflicting keys reject the whole update", async () => {
  const { runner } = fixture(); await runner.start(program());
  const first = await runner.update(done("who", ["identity"]));
  assert.equal((await runner.update(done("who", ["identity"]))).version, first.version);
  await assert.rejects(runner.update(done("who", ["parties", "typo"])), /Unknown goal item/);
  await assert.rejects(runner.update({ ...done("who", ["parties"]), deferred: ["parties"] }), /only once/);
  await assert.rejects(runner.update({ ...done("who", ["parties"]), reason: " " }));
  assert.equal((await runner.status())!.version, first.version);
  assert.equal((await runner.status())!.goals[0].items[1].state, null);
});

test("definition revisions retain same-key progress, reopen completed goals for new items, and persist through restart", async () => {
  const { adapter, runner } = fixture(); await runner.start(program());
  const completed = await runner.update(done("who", ["identity", "parties"]));
  const revised = program();
  revised.goals[0].items[0].label = "Existing client identity verified";
  revised.goals[0].items.push({ key: "changes", label: "What changed since the last matter?" });
  const result = await runner.revise(revised, { ifVersion: completed.version, reason: "Returning client with a new matter" });
  assert.equal(result.activeGoal, "who");
  assert.equal(result.goals[0].items[0].state!.disposition, "done");
  assert.equal(result.goals[0].items[2].state, null);
  const restarted = new GoalRunner(adapter, { scope });
  assert.deepEqual(await restarted.status(), result);
  const history = await restarted.history();
  assert.equal(history.length, 3);
  assert.equal(history[0].program.goals[0].items.length, 2);
  assert.equal(history[2].reason, "Returning client with a new matter");
  assert.equal(history[2].provenance.actor, "test");
  assert.equal(history[2].provenance.source, "conversation:1");
});

test("an existing-matter follow-up retires old goals while preserving outstanding deferred work", async () => {
  const { runner } = fixture(); await runner.start(program());
  await runner.update(done("who", ["identity", "parties"]));
  const before = await runner.update({ goalKey: "evidence", completed: ["account"], deferred: ["documents"], reason: "Awaiting files" });
  const followup = program();
  followup.goals = [{ key: "updates", title: "Matter updates", objective: "Capture the new development", items: [{ key: "news", label: "New development" }] }];
  const after = await runner.revise(followup, { ifVersion: before.version, reason: "Existing matter, only need updates" });
  assert.equal(after.activeGoal, "updates");
  assert.equal(after.deferred[0].retired, true);
  assert.equal(after.deferred[0].label, "Documents");
  await assert.rejects(runner.update({ goalKey: "evidence", reopened: ["documents"], reason: "Retry" }), /Restore retired/);
  const resolved = await runner.update(done("evidence", ["documents"]));
  assert.equal(resolved.deferred.length, 0);
  const restored = await runner.revise(program(), { ifVersion: resolved.version, reason: "Resume original intake" });
  assert.equal(restored.status, "completed", "stable keys restore their original progress");
});

test("locked obligations cannot be removed, edited, retired, or unlocked", async () => {
  const { runner } = fixture(); const initial = program();
  initial.goals[0].items[0].locked = true;
  initial.goals[1].locked = true;
  await runner.start(initial);
  const mutations = [
    (p: GoalProgram) => { p.goals.shift(); },
    (p: GoalProgram) => { p.goals[0].items[0].label = "Forget identity"; },
    (p: GoalProgram) => { p.goals[0].items[0].locked = false; },
    (p: GoalProgram) => { p.goals[0].retired = true; },
    (p: GoalProgram) => { p.goals[1].objective = "Skip evidence"; },
    (p: GoalProgram) => { p.goals[1].locked = false; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(initial); mutate(changed);
    await assert.rejects(runner.revise(changed, { ifVersion: 1, reason: "Change context" }), /locked/i);
  }
  assert.equal((await runner.status())!.version, 1);
});

test("definition validation rejects duplicate/reserved keys and program identity replacement", async () => {
  const invalid = program(); invalid.goals[0].items.push(invalid.goals[0].items[0]);
  assert.throws(() => defineGoalProgram(invalid), /Duplicate item/);
  const duplicate = program(); duplicate.goals.push(duplicate.goals[0]);
  assert.throws(() => defineGoalProgram(duplicate), /Duplicate goal/);
  for (const key of ["__proto__", "constructor", "prototype", "", "has space"]) {
    const bad = program(); bad.goals[0].key = key;
    assert.throws(() => defineGoalProgram(bad));
  }
  const { runner } = fixture(); await runner.start(program());
  await assert.rejects(runner.revise({ ...program(), key: "other" }, { ifVersion: 1, reason: "Switch" }), /identity cannot change/);
});

test("all-retired or empty programs are completed; adding a goal makes them active", async () => {
  const { runner } = fixture(); await runner.start({ key: "intake", goals: [] });
  assert.equal((await runner.status())!.status, "completed");
  const result = await runner.revise(program(), { ifVersion: 1, reason: "Matter identified" });
  assert.equal(result.activeGoal, "who");
  const retired = program(); retired.goals.forEach((g) => { g.retired = true; });
  assert.equal((await runner.revise(retired, { ifVersion: 2, reason: "No longer applicable" })).status, "completed");
});

test("concurrent start is idempotent and disjoint updates merge without lost progress", async () => {
  const { adapter, runner } = fixture(); const other = new GoalRunner(adapter, { scope });
  await Promise.all([runner.start(program()), other.start(program())]);
  assert.equal((await runner.history()).length, 1);
  await Promise.all([runner.update(done("who", ["identity"])), other.update(done("who", ["parties"]))]);
  const status = (await runner.status())!;
  assert.equal(status.goals[0].status, "completed");
  assert.equal(status.version, 3);
  assert.equal((await runner.history()).length, 3);
});

test("concurrent same-item updates and concurrent definition revisions surface a conflict", async () => {
  const { adapter, runner } = fixture(); const other = new GoalRunner(adapter, { scope });
  await runner.start(program());
  const outcomes = await Promise.allSettled([
    runner.update(done("who", ["identity"])),
    other.update({ goalKey: "who", declined: ["identity"], reason: "Declined" }),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  const failure = outcomes.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.ok(failure.reason instanceof GoalConflictError);
  const a = program(); a.goals[0].title = "Option A";
  const b = program(); b.goals[0].title = "Option B";
  const revisions = await Promise.allSettled([
    runner.revise(a, { ifVersion: 2, reason: "A" }), other.revise(b, { ifVersion: 2, reason: "B" }),
  ]);
  assert.equal(revisions.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok((revisions.find((r) => r.status === "rejected") as PromiseRejectedResult).reason instanceof GoalConflictError);
});

test("explicit stale versions reject progress updates without modifying state", async () => {
  const { runner } = fixture(); await runner.start(program());
  await runner.update(done("who", ["identity"]));
  await assert.rejects(runner.update({ ...done("who", ["parties"]), ifVersion: 1 }), GoalConflictError);
  assert.equal((await runner.status())!.goals[0].items[1].state, null);
});

test("adapter returns detached snapshots and enforces CAS/append-only history", async () => {
  const { adapter, runner } = fixture(); const p = program(); await runner.start(p);
  p.goals[0].title = "Mutated caller object";
  const snapshot = (await runner.inspect())!;
  snapshot.program.goals[0].title = "Mutated read";
  snapshot.history[0].reason = "Mutated audit";
  assert.notEqual((await runner.inspect())!.program.goals[0].title, snapshot.program.goals[0].title);
  await assert.rejects(adapter.commit(scope, snapshot, { ifVersion: null }), GoalConflictError);
  snapshot.version = 2;
  await assert.rejects(adapter.commit(scope, snapshot, { ifVersion: 1 }), /history/);
  assert.equal((await runner.status())!.version, 1);
});

test("host policy rejects writes before commit and callback errors explicitly report a committed write", async () => {
  const adapter = new InMemoryGoalAdapter();
  const runner = new GoalRunner(adapter, { scope, validateChange({ after }) {
    if (after.progress.who?.identity?.disposition === "declined") throw new Error("Identity is required by this application");
  } });
  await runner.start(program());
  await assert.rejects(runner.update({ goalKey: "who", declined: ["identity"], reason: "Skip" }), /Identity is required/);
  assert.equal((await runner.status())!.version, 1);
  const callback = new GoalRunner(adapter, { scope, onChange() { throw new Error("Refresh failed"); } });
  await assert.rejects(callback.update(done("who", ["identity"])), (error: unknown) => error instanceof GoalPostCommitError && error.status.version === 2);
  assert.equal((await runner.status())!.version, 2);
});

function target() {
  const context = runtimeContextSupport();
  let prompt = "Host instructions";
  const tools: Array<GloveFoldArgs<any>> = [];
  const seen: string[] = [];
  return {
    tools, seen, ...context,
    fold<I>(args: GloveFoldArgs<I>) { tools.push(args); },
    getSystemPrompt() { return prompt; }, setSystemPrompt(value: string) { prompt = value; },
    async processRequest(_request: string) { seen.push(prompt + await context.getRuntimeContext()); return { sender: "agent" as const, text: "ok" }; },
  };
}

test("tools use the same runner, require versions, report validation errors, and never accept a model-selected scope", async () => {
  const { runner } = fixture(); const tools = buildGoalRunnerTools(runner);
  const invoke = (name: string, input: unknown) => tools.find((tool) => tool.name === `glove_goal_${name}`)!.do(input, null as never, null as never);
  assert.equal((await invoke("start", { program: program(), reason: "Intake" })).status, "success");
  assert.equal((await invoke("update", done("who", ["identity"]))).status, "error");
  assert.equal((await invoke("update", { ...done("who", ["identity"]), ifVersion: 1 })).status, "success");
  assert.equal((await invoke("update", { ...done("who", ["parties"]), ifVersion: 1 })).status, "error");
  assert.equal((await invoke("status", { scope: { subject: "another" } })).status, "error");
  assert.equal((await runner.status())!.version, 2);
  assert.equal((await invoke("history", {})).status, "success");
});

test("tool selection leaves host operations available and rejected selectors do not partially mount", async () => {
  const glove = target();
  const { runner } = useGoalRunner(glove, new InMemoryGoalAdapter(), { scope, tools: { deny: ["start", "revise"] } });
  assert.deepEqual(glove.tools.map((t) => t.name), ["glove_goal_status", "glove_goal_update", "glove_goal_history"]);
  await runner.start(program());
  assert.match(await glove.getRuntimeContext(), /GOALS/);
  const invalid = target();
  assert.throws(() => useGoalRunner(invalid, new InMemoryGoalAdapter(), { scope, tools: { deny: ["typo"] } }));
  assert.equal(invalid.tools.length, 0);
});

for (const goalsFirst of [true, false]) {
  test(`forms, context and goals compose in either installation order (goalsFirst=${goalsFirst})`, async () => {
    const glove = target();
    const schema = new MemorySchema();
    const def = defineForm({ id: "details", version: 1, name: "Details", description: "Client details" })
      .step("details", { title: "Details", preview: "contact" }, (s) => s.field("email", { schema: z.string(), label: "Email address" })).build();
    const registry = new FormRegistry().register("details", { name: "Details", description: "Client details", load: () => def });
    const attachGoals = () => useGoalRunner(glove, new InMemoryGoalAdapter(), { scope });
    const attachForms = () => useFormRunner(glove, new InMemoryFormAdapter({ schema }), { registry, subject: scope.subject });
    const goals = goalsFirst ? attachGoals() : undefined;
    const forms = attachForms();
    const mountedGoals = goals ?? attachGoals();
    const context = new InMemoryContextAdapter({ schema });
    // A deterministic render avoids coupling this composition regression to context storage policy.
    context.render = async () => "PINNED CONTEXT: returning client";
    useContext(glove, context);
    await forms.runner.start("details");
    await mountedGoals.runner.start(program());
    for (let i = 0; i < 2; i++) await glove.processRequest("hello");
    const composed = await glove.getRuntimeContext();
    assert.match(composed, /Email address/);
    assert.match(composed, /GOALS/);
    assert.match(composed, /PINNED CONTEXT/);
    assert.equal(composed.match(/GOALS —/g)?.length, 1);
    assert.equal(composed.match(/Email address/g)?.length, 1);
    glove.setSystemPrompt(glove.getSystemPrompt() + "\nHost added instructions");
    await mountedGoals.runner.update(done("who", ["identity"]));
    assert.match(await glove.getRuntimeContext(), /identity: Client identity \[done\]/, "refreshes immediately after host writes");
    assert.match(await glove.getRuntimeContext(), /Email address/);
    await glove.processRequest("next");
    assert.match(glove.getSystemPrompt(), /Host added instructions/);
    await forms.runner.fill({ email: "client@example.com" });
    await glove.processRequest("done");
    assert.doesNotMatch(await glove.getRuntimeContext(), /Email address/);
    assert.match(await glove.getRuntimeContext(), /GOALS/);
  });
}

test("scope changes and host prompt replacement clear stale goals; injection can be disabled", async () => {
  let subject = "one";
  const glove = target(); const adapter = new InMemoryGoalAdapter();
  const { runner } = useGoalRunner(glove, adapter, { scope: () => ({ subject, key: "intake" }) });
  await runner.start(program());
  await glove.processRequest("one");
  subject = "two";
  await glove.processRequest("two");
  assert.equal(glove.getSystemPrompt(), "Host instructions");
  subject = "one";
  glove.setSystemPrompt("Replacement host instructions");
  await glove.processRequest("one again");
  assert.match(glove.getSystemPrompt(), /^Replacement host instructions/);
  assert.equal((await glove.getRuntimeContext()).match(/GOALS —/g)?.length, 1);
  const off = target();
  const mounted = useGoalRunner(off, adapter, { scope: { subject: "one", key: "intake" }, injectStatus: false });
  await mounted.runner.update(done("who", ["identity"]));
  await off.processRequest("hello");
  assert.equal(off.getSystemPrompt(), "Host instructions");
});

test("a real Glove sees mounted schemas and updated goal status on the next model step", async () => {
  let calls = 0;
  let systemPrompt = "";
  const adapter = new InMemoryGoalAdapter();
  const model: ModelAdapter = {
    name: "scripted-goals",
    setSystemPrompt(value) { systemPrompt = value; },
    async prompt(request) {
      assert.ok(request.tools!.some((t) => t.name === "glove_goal_update"));
      if (calls++ === 0) {
        assert.equal(systemPrompt, "Help the client");
        assert.match(request.messages.at(-1)!.text!, /version 1/);
        return { messages: [{ sender: "agent", text: "", tool_calls: [{ id: "update", tool_name: "glove_goal_update", input_args: { ...done("who", ["identity", "parties"]), ifVersion: 1 } }] }], tokens_in: 1, tokens_out: 1 };
      }
      assert.equal(systemPrompt, "Help the client");
      assert.match(request.messages.at(-1)!.text!, /version 2/);
      assert.match(request.messages.at(-1)!.text!, /evidence; active/);
      return { messages: [{ sender: "agent", text: "Next, evidence" }], tokens_in: 1, tokens_out: 1 };
    },
  };
  const glove = new Glove({ model, displayManager: new Displaymanager(), systemPrompt: "Help the client", compaction_config: { compaction_instructions: "Summarize" } }).build();
  const { runner } = useGoalRunner(glove, adapter, { scope });
  await runner.start(program());
  await glove.processRequest("I am an existing client");
  assert.equal(calls, 2);
  assert.equal((await runner.status())!.activeGoal, "evidence");
});

test("a delayed status read cannot erase a newer committed prompt refresh", async () => {
  const adapter = new InMemoryGoalAdapter();
  const glove = target();
  const { runner, refresh } = useGoalRunner(glove, adapter, { scope });
  await runner.start(program());
  const original = adapter.get.bind(adapter);
  let release!: () => void;
  let captured!: () => void;
  const snapshotCaptured = new Promise<void>((resolve) => { captured = resolve; });
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let delayNextRead = true;
  adapter.get = async (requestedScope) => {
    const snapshot = await original(requestedScope);
    if (delayNextRead) {
      delayNextRead = false;
      captured();
      await delayed;
    }
    return snapshot;
  };
  const staleRefresh = refresh();
  await snapshotCaptured;
  await runner.update(done("who", ["identity"]));
  assert.match(await glove.getRuntimeContext(), /version 2/);
  release();
  await staleRefresh;
  assert.match(await glove.getRuntimeContext(), /version 2/);
});

test("concurrent definition edits and progress writes do not lose either winner's state", async () => {
  const { adapter, runner } = fixture(); const other = new GoalRunner(adapter, { scope });
  await runner.start(program());
  const changed = program(); changed.goals[0].items.push({ key: "extra", label: "New obligation" });
  const results = await Promise.allSettled([
    runner.revise(changed, { ifVersion: 1, reason: "New context" }),
    other.update(done("who", ["identity"])),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason instanceof GoalConflictError);
  assert.equal((await runner.status())!.version, 2);
});

test("all prototype property names are rejected as durable goal and item keys", () => {
  for (const key of Object.getOwnPropertyNames(Object.prototype)) {
    const goal = program(); goal.goals[0].key = key;
    assert.throws(() => defineGoalProgram(goal), `goal key ${key}`);
    const item = program(); item.goals[0].items[0].key = key;
    assert.throws(() => defineGoalProgram(item), `item key ${key}`);
  }
});

function reorderJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reorderJson) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorderJson(child)])) as T;
  }
  return value;
}

test("database JSON property reordering does not break idempotence, locks, or history", async () => {
  const adapter = new InMemoryGoalAdapter();
  const get = adapter.get.bind(adapter);
  adapter.get = async (scope) => reorderJson(await get(scope));
  const runner = new GoalRunner(adapter, { scope });
  const initial = program(); initial.goals[0].locked = true;
  await runner.start(initial);
  assert.equal((await runner.start(initial)).version, 1);
  const revised = program(); revised.goals[0].locked = true;
  revised.goals[1].title = "Updated evidence title";
  assert.equal((await runner.revise(revised, { ifVersion: 1, reason: "New context" })).version, 2);
  assert.equal((await runner.update(done("who", ["identity"]))).version, 3);
  assert.equal((await runner.history()).length, 3);
});

test("out-of-order commit responses cannot roll the prompt back to an older goal version", async () => {
  const adapter = new InMemoryGoalAdapter();
  const glove = target();
  const { runner } = useGoalRunner(glove, adapter, { scope });
  await runner.start(program());
  const commit = adapter.commit.bind(adapter);
  let release!: () => void;
  let committed!: () => void;
  const firstCommitted = new Promise<void>((resolve) => { committed = resolve; });
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  adapter.commit = async (scope, next, options) => {
    const saved = await commit(scope, next, options);
    if (saved.version === 2) { committed(); await delayed; }
    return saved;
  };
  const slow = runner.update(done("who", ["identity"]));
  await firstCommitted;
  await runner.update(done("who", ["parties"]));
  assert.match(await glove.getRuntimeContext(), /version 3/);
  release();
  await slow;
  assert.match(await glove.getRuntimeContext(), /version 3/);
});

test("a stale read cannot regress the prompt after a committed update", async () => {
  const adapter = new InMemoryGoalAdapter(); const glove = target();
  const { runner, refresh } = useGoalRunner(glove, adapter, { scope });
  await runner.start(program());
  const stale = await runner.inspect();
  await runner.update(done("who", ["identity"]));
  adapter.get = async () => structuredClone(stale);
  await refresh();
  assert.match(await glove.getRuntimeContext(), /version 2/);
});

test("the complete goal tool workflow runs through a real Glove executor and serializable schemas", async () => {
  const adapter = new InMemoryGoalAdapter();
  const initial = program();
  const changed = program(); changed.goals.reverse();
  const calls = [
    { name: "start", input: { program: initial, reason: "Client intake" } },
    { name: "status", input: {} },
    { name: "revise", input: { program: changed, ifVersion: 1, reason: "Evidence is the immediate priority" } },
    { name: "update", input: { goalKey: "evidence", completed: ["account"], deferred: ["documents"], ifVersion: 2, reason: "Waiting for files" } },
    { name: "history", input: {} },
  ];
  let step = 0;
  let prompt = "";
  const events: Array<{ tool_name: string; result: { status: string; data?: unknown } }> = [];
  const model: ModelAdapter = {
    name: "audit-complete-workflow", setSystemPrompt(value) { prompt = value; },
    async prompt(request) {
      for (const tool of request.tools!.filter((entry) => entry.name.startsWith("glove_goal_"))) {
        const schema = JSON.parse(JSON.stringify(z.toJSONSchema(tool.input_schema!)));
        assert.equal(schema.type, "object");
        assert.equal(schema.additionalProperties, false);
      }
      const call = calls[step++];
      if (call) return { messages: [{ sender: "agent", text: "", tool_calls: [{ id: String(step), tool_name: `glove_goal_${call.name}`, input_args: call.input }] }], tokens_in: 1, tokens_out: 1 };
      assert.match(request.messages.at(-1)!.text!, /version 3/);
      assert.match(request.messages.at(-1)!.text!, /who; active/);
      assert.match(request.messages.at(-1)!.text!, /Waiting for files/);
      return { messages: [{ sender: "agent", text: "Continue with identity" }], tokens_in: 1, tokens_out: 1 };
    },
  };
  const glove = new Glove({ model, displayManager: new Displaymanager(), systemPrompt: "Help the client", compaction_config: { compaction_instructions: "Summarize" } }).build();
  glove.addSubscriber({ async record(type, data) {
    if (type === "tool_use_result") events.push(data as typeof events[number]);
  } });
  const { runner } = useGoalRunner(glove, adapter, { scope });
  await glove.processRequest("Help me with intake");
  assert.equal(events.length, calls.length);
  assert.ok(events.every((event) => event.result.status === "success"));
  assert.equal((await runner.history()).length, 3);
  assert.deepEqual((await runner.status())!.goals.map((goal) => goal.definition.key), ["evidence", "who"]);
});

test("retries stop at five attempts and do not report uncommitted progress", async () => {
  const { adapter, runner } = fixture(); await runner.start(program());
  let attempts = 0;
  adapter.commit = async (_scope, _next, options) => { attempts++; throw new GoalConflictError(options.ifVersion, 2); };
  await assert.rejects(runner.update(done("who", ["identity"])), GoalConflictError);
  assert.equal(attempts, 5);
  assert.equal((await runner.status())!.version, 1);
  assert.equal((await runner.status())!.goals[0].items[0].state, null);
});

test("tools distinguish a post-commit callback failure from a rejected write", async () => {
  const adapter = new InMemoryGoalAdapter();
  const runner = new GoalRunner(adapter, { scope, onChange() { throw new Error("Notification unavailable"); } });
  const tools = buildGoalRunnerTools(runner);
  const start = tools.find((tool) => tool.name === "glove_goal_start")!;
  const result = await start.do({ program: program(), reason: "Start" }, null as never, null as never);
  assert.equal(result.status, "error");
  assert.equal((result.data as { committed: boolean }).committed, true);
  assert.equal((await runner.status())!.version, 1);
});

test("retiring just an item preserves its deferral and restoring it permits reopening", async () => {
  const { runner } = fixture(); await runner.start(program());
  await runner.update({ goalKey: "who", completed: ["identity"], deferred: ["parties"], reason: "Ask later" });
  const retired = program(); retired.goals[0].items[1].retired = true;
  const status = await runner.revise(retired, { ifVersion: 2, reason: "Not relevant today" });
  assert.equal(status.activeGoal, "evidence");
  assert.equal(status.deferred[0].retired, true);
  await runner.revise(program(), { ifVersion: 3, reason: "Relevant again" });
  assert.equal((await runner.update({ goalKey: "who", reopened: ["parties"], reason: "Ask now" })).activeGoal, "who");
});

test("a pre-create null read does not let a delayed create acknowledgement regress later progress", async () => {
  const adapter = new InMemoryGoalAdapter(); const glove = target();
  const { runner, refresh } = useGoalRunner(glove, adapter, { scope });
  const get = adapter.get.bind(adapter); const commit = adapter.commit.bind(adapter);
  let readCaptured!: () => void; let releaseRead!: () => void;
  const captured = new Promise<void>((resolve) => { readCaptured = resolve; });
  const readDelay = new Promise<void>((resolve) => { releaseRead = resolve; });
  let firstRead = true;
  adapter.get = async (scope) => {
    const result = await get(scope);
    if (firstRead) { firstRead = false; readCaptured(); await readDelay; }
    return result;
  };
  let created!: () => void; let releaseCreate!: () => void;
  const didCreate = new Promise<void>((resolve) => { created = resolve; });
  const createDelay = new Promise<void>((resolve) => { releaseCreate = resolve; });
  adapter.commit = async (scope, next, options) => {
    const saved = await commit(scope, next, options);
    if (saved.version === 1) { created(); await createDelay; }
    return saved;
  };
  const oldRead = refresh(); await captured;
  const start = runner.start(program()); await didCreate;
  await runner.update(done("who", ["identity"]));
  releaseRead(); await oldRead;
  releaseCreate(); await start;
  assert.match(await glove.getRuntimeContext(), /version 2/);
});

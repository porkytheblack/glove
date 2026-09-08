import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { FactStore, FactPreparation, InMemoryFactAdapter, createModelPreparation, type Fact, type FactRequirement } from "glove-facts";
import { GoalRunner, defineGoalProgram, renderGoalStatus } from "../src/goals";
import { InMemoryGoalAdapter } from "../src/in-memory/goals";
import { FormRunner, FormRegistry, defineForm, inForce } from "../src/forms";
import { InMemoryFormAdapter } from "../src/in-memory/forms";
import { MemorySchema } from "../src/core/schema";
import { useGoalRunner } from "../src/tools/goals";
import { useFormRunner } from "../src/tools/forms";

const scope = { subject: "client:1", context: "matter:1" };
const goalScope = { subject: scope.subject, key: "intake" };
const program = defineGoalProgram({ key: "intake", goals: [
  { key: "identity", title: "Identity", objective: "Get identity", items: [{ key: "name", label: "Name" }] },
  { key: "contact", title: "Contact", objective: "Get contact details", items: [{ key: "email", label: "Email" }, { key: "phone", label: "Phone" }] },
] });
const rule = { kind: "information" as const, criteria: "Use the supplied value" };
async function setup() {
  const facts = new FactStore(new InMemoryFactAdapter(), { scope });
  const add = (key: string, value: unknown, extras: any = {}) => facts.record({ text: `${key}: ${value}`, value: { key, value }, source: { kind: "message", id: key }, verification: "verified", ...extras }, { operationId: `${key}-${JSON.stringify(value)}-${JSON.stringify(extras)}` });
  let calls = 0;
  const model = { name: "preparer", setSystemPrompt() {}, async prompt(request: any) {
    calls++;
    const data = JSON.parse(request.messages[0].text.split("\n\nDATA:\n")[1]);
    return { messages: [{ sender: "agent" as const, text: "", tool_calls: [{ tool_name: "submit_preparation", input_args: { proposals: data.requirements.flatMap((r: FactRequirement) => {
      const key = r.id.split("/").at(-1)!;
      const fact = data.facts.findLast((f: Fact) => (f.value as any)?.key === key);
      return fact ? [{ requirement: r.id, value: r.id.includes("/") ? true : fact.value.value, refs: [{ id: fact.id, revision: fact.revision }], strength: "sufficient", derivation: "explicit", explanation: `Supplied ${key}` }] : [];
    }) } }] }], tokens_in: 1, tokens_out: 1 };
  } };
  const preparer = new FactPreparation(facts, { enabled: true, inference: createModelPreparation(model) });
  return { facts, add, preparer, calls: () => calls };
}
function forms(preparer: FactPreparation, options: { rule?: any; onEmail?: () => void; onStep?: () => void; checkpoint?: () => void; conditional?: boolean } = {}) {
  const def = defineForm({ id: "intake", version: 1, name: "Intake", description: "Contact details" })
    .step("identity", { title: "Identity" }, s => s.field("name", { label: "Name", schema: z.string().min(1) }))
    .step("contact", { title: "Contact", ...(options.conditional ? { when: (v: any) => !!v.name } : {}), onComplete: options.onStep }, s => s
      .field("email", { label: "Email", schema: z.email(), onFill: options.onEmail })
      .field("phone", { label: "Phone", schema: z.string().min(3).optional() }));
  if (options.checkpoint) def.checkpoint("approval", { when: (v: any) => !!v.email, blocking: true, run: options.checkpoint });
  const registry = new FormRegistry().register("intake", { name: "Intake", description: "Contact", load: async () => def.build() });
  const adapter = new InMemoryFormAdapter({ schema: new MemorySchema() });
  const config = { registry, subject: scope.subject, preparation: { preparer, rule: options.rule ?? (() => rule) } };
  return { runner: new FormRunner(adapter, config), adapter, config };
}
function target() { let prompt = "Host instructions"; const tools: any[] = []; return { tools, fold: (t: any) => { tools.push(t); }, getSystemPrompt: () => prompt, setSystemPrompt: (p: string) => { prompt = p; }, processRequest: async () => ({ sender: "agent" as const, text: prompt }) }; }

test("early facts complete goals atomically before onEnter and expose full prepared context", async () => {
  const { preparer, add, calls } = await setup(); await add("name", "Ada"); await add("email", "ada@example.com");
  const entered: any[] = [];
  const runner = new GoalRunner(new InMemoryGoalAdapter(), { scope: goalScope, preparation: { preparer, rule: () => rule }, hooks: { onEnter: c => { entered.push(c); } } });
  const result = await runner.start(program);
  assert.equal(result.activeGoal, "contact"); assert.equal(result.goals[0].status, "completed");
  assert.equal(result.goals[1].items[0].state!.done, true);
  assert.equal(entered.length, 1); assert.equal(entered[0].goal.definition.key, "contact");
  assert.ok(entered[0].status.preparation); assert.match(renderGoalStatus(result), /ada|sources=/);
  assert.equal(calls(), 1);
});
test("goals and forms use the same fact records with separate links and validated commits", async () => {
  const { preparer, add, facts } = await setup(); await add("name", "Ada"); await add("email", "ada@example.com");
  const goals = new GoalRunner(new InMemoryGoalAdapter(), { scope: goalScope, preparation: { preparer, rule: () => rule } });
  await goals.start(program);
  let hooks = 0; const { runner } = forms(preparer, { onEmail: () => { hooks++; } });
  const result = await runner.start("intake"); const { instance } = await runner.resolve();
  assert.equal(result.view.complete, true); assert.equal(hooks, 1);
  assert.equal(inForce(instance.entries.email)!.value, "ada@example.com"); assert.ok(inForce(instance.entries.email)!.claimId);
  assert.equal(instance.entries.email.revisions.length, 1);
  const state = await facts.inspect(); const email = state.facts.find(f => (f.value as any).key === "email")!;
  const claims = state.claims.filter(c => c.refs.some(r => r.id === email.id) && c.state === "accepted");
  assert.equal(claims.length, 2); assert.notEqual(claims[0].consumer, claims[1].consumer);
});
test("unverified facts yield clarification and invalid synthesized values never enter form history", async () => {
  const { preparer, add } = await setup(); await add("name", "Ada"); await add("email", "bad email");
  const { runner } = forms(preparer); const result = await runner.start("intake");
  assert.ok(result.view.preparation?.error); assert.equal((await runner.resolve()).instance.entries.email, undefined);
  assert.equal(result.view.complete, false);
});
test("correction flags completed work for review without replaying effects or overwriting answers", async () => {
  const { preparer, add, facts } = await setup(); await add("name", "Ada"); const old = await add("email", "ada@example.com");
  let hooks = 0; const { runner } = forms(preparer, { onEmail: () => { hooks++; } });
  await runner.start("intake");
  await facts.record({ text: "New email", value: { key: "email", value: "new@example.com" }, source: { kind: "message", id: "m2" }, verification: "verified" }, { operationId: "correct", supersedes: old });
  const view = await runner.prepare(); assert.equal(view.preparation!.decisions.find(d => d.requirement === "email")!.status, "review");
  assert.equal(inForce((await runner.resolve()).instance.entries.email)!.value, "ada@example.com"); assert.equal(hooks, 1);
  await runner.fill({ email: "new@example.com" }); assert.equal((await runner.resolve()).instance.entries.email.revisions.length, 2);
});
test("repeated and concurrent preparation after restart does not duplicate history, claims or hooks", async () => {
  const { preparer, add, facts } = await setup(); await add("name", "Ada"); await add("email", "ada@example.com");
  let hooks = 0; const { runner, adapter, config } = forms(preparer, { onEmail: () => { hooks++; } }); await runner.start("intake");
  const restarted = new FormRunner(adapter, config);
  await Promise.all([runner.prepare(), restarted.prepare()]); await restarted.prepare();
  const instance = (await runner.resolve()).instance;
  assert.equal(instance.entries.email.revisions.length, 1); assert.equal(hooks, 1);
  assert.equal((await facts.inspect()).claims.filter(c => c.requirement === "email").length, 1);
});
test("disabled auto preparation leaves capture and manual operations available", async () => {
  const { preparer, add, calls, facts } = await setup(); preparer.config.enabled = false; await add("email", "ada@example.com");
  const { runner } = forms(preparer); await runner.start("intake"); await runner.fill({ name: "Ada" });
  assert.equal(calls(), 0); assert.equal((await facts.inspect()).claims.length, 0);
  assert.equal((await runner.resolve()).instance.entries.email, undefined);
  preparer.config.enabled = true; await runner.prepare(); assert.equal(calls(), 1);
  preparer.config.enabled = false; const before = await runner.resolve(); await runner.prepare(); assert.deepEqual((await runner.resolve()).instance, before.instance);
});
test("upcoming gated steps are prepared without activation or committing their answers", async () => {
  const { preparer, add } = await setup(); await add("email", "ada@example.com");
  const { runner } = forms(preparer, { conditional: true });
  const result = await runner.start("intake");
  assert.equal(result.view.preparation!.decisions.find(d => d.requirement === "email")!.status, "ineligible");
  assert.equal((await runner.resolve()).instance.entries.email, undefined);
  await runner.fill({ name: "Ada" }); assert.equal(inForce((await runner.resolve()).instance.entries.email)!.value, "ada@example.com");
});
test("successful prior action fulfills only host-selected effects, keeping approval checkpoints", async () => {
  const { preparer, add } = await setup(); await add("name", "Ada");
  await add("email", "ada@example.com", { source: { kind: "tool", id: "sent-email" }, evidence: { kind: "action", key: "welcome-sent", result: "success" } });
  let sends = 0; let approvals = 0;
  const { runner } = forms(preparer, { onEmail: () => { sends++; }, checkpoint: () => { approvals++; }, rule: (f: any) => f.id === "email" ? { kind: "action", criteria: "Welcome email sent", evidenceKey: "welcome-sent", fulfills: ["field"] } : rule });
  await runner.start("intake"); assert.equal(sends, 0); assert.equal(approvals, 1);
  const dispatches = Object.values((await runner.resolve()).instance.dispatches);
  assert.ok(dispatches.some(d => d.hookId === "field:email" && d.claimId));
});
test("an intention cannot prefill an action result or suppress its executor", async () => {
  const { preparer, add } = await setup(); await add("name", "Ada");
  await add("email", "ada@example.com", { evidence: { kind: "action", key: "welcome-sent", result: "intention" } });
  let sends = 0; const { runner } = forms(preparer, { onEmail: () => { sends++; }, rule: (f: any) => f.id === "email" ? { kind: "action", criteria: "Welcome email sent", evidenceKey: "welcome-sent", fulfills: ["field"] } : rule });
  const result = await runner.start("intake"); assert.equal(result.view.complete, false); assert.equal((await runner.resolve()).instance.entries.email, undefined);
  await runner.fill({ email: "ada@example.com" }); assert.equal(sends, 1);
});
test("goal progression and voice tool replies carry prepared context in the same turn", async () => {
  const { preparer, add } = await setup(); const glove = target();
  const mounted = useGoalRunner(glove, new InMemoryGoalAdapter(), { scope: goalScope, preparation: { preparer, rule: () => rule } });
  await mounted.runner.start(program); await add("email", "ada@example.com");
  const before = await mounted.runner.status();
  const update = glove.tools.find(t => t.name === "glove_goal_update");
  const result = await update.do({ goalKey: "identity", completed: ["name"], reason: "Name received", ifVersion: before!.version });
  assert.equal(result.status, "success"); assert.equal(result.data.activeGoal, "contact");
  assert.ok(result.data.preparation); assert.match(glove.getSystemPrompt(), /sources=/); assert.match(glove.getSystemPrompt(), /Phone/);
});
test("mounted forms reconcile before model invocation even with prompt injection disabled", async () => {
  const { preparer, add } = await setup(); const { adapter, config } = forms(preparer); const glove = target();
  const { runner } = useFormRunner(glove, adapter, { ...config, injectStatus: false }); await runner.start("intake");
  await add("name", "Ada"); await add("email", "ada@example.com"); await glove.processRequest();
  assert.equal((await runner.status()).complete, true);
});
test("inference failure leaves goals actionable without false completion", async () => {
  const { preparer } = await setup(); preparer.config.inference.infer = async () => { throw new Error("model unavailable"); };
  const runner = new GoalRunner(new InMemoryGoalAdapter(), { scope: goalScope, preparation: { preparer, rule: () => rule } });
  const status = await runner.start(program); assert.equal(status.activeGoal, "identity"); assert.match(renderGoalStatus(status), /model unavailable/);
});
test("consumer subject mismatch is rejected before committing any answers", async () => {
  const { preparer } = await setup(); const runner = new GoalRunner(new InMemoryGoalAdapter(), { scope: { ...goalScope, subject: "client:other" }, preparation: { preparer, rule: () => rule } });
  await assert.rejects(runner.start(program), /subjects must match/); assert.equal(await runner.inspect(), null);
});

test("newly eligible conditional steps are prepared before their first committed activation", async () => {
  const { preparer, add } = await setup(); await add("name", "Ada"); await add("email", "ada@example.com");
  let hooks = 0; const { runner } = forms(preparer, { conditional: true, onEmail: () => { hooks++; } });
  const result = await runner.start("intake"); assert.equal(result.view.complete, true); assert.equal(hooks, 1);
});
test("manual retraction is not automatically refilled from unchanged evidence", async () => {
  const { preparer, add } = await setup(); await add("name", "Ada"); await add("email", "ada@example.com");
  const { runner } = forms(preparer); await runner.start("intake");
  await runner.retract("email");
  await runner.prepare(); assert.equal(inForce((await runner.resolve()).instance.entries.email), undefined);
});
test("early document evidence is retained and prepares a later goal", async () => {
  const { preparer, add } = await setup(); await add("email", "ada@example.com", { source: { kind: "document", id: "uploaded-contract:page1" } });
  const runner = new GoalRunner(new InMemoryGoalAdapter(), { scope: goalScope, preparation: { preparer, rule: () => rule } });
  const status = await runner.start(program); assert.equal(status.activeGoal, "identity"); assert.ok(status.goals[1].items[0].state?.done);
  assert.ok(status.preparation!.decisions.find(d => d.requirement === "contact/email")!.claim?.refs.length);
});
test("prepared form commits resume interrupted hooks under their original idempotency key", async () => {
  const { preparer, add } = await setup(); await add("name", "Ada"); await add("email", "ada@example.com");
  let hooks = 0; const { runner, adapter, config } = forms(preparer, { onEmail: () => { hooks++; } });
  const original = adapter.recordDispatch.bind(adapter); let crash = true;
  adapter.recordDispatch = async (...args) => { if (crash) { crash = false; throw new Error("process interrupted before dispatch"); } return original(...args); };
  await assert.rejects(runner.start("intake"), /interrupted/);
  const instance = (await runner.resolve()).instance;
  assert.equal(instance.entries.email.revisions.length, 1); assert.equal(Object.keys(instance.pendingHooks!).length, 1); assert.equal(hooks, 0);
  const restarted = new FormRunner(adapter, config); await restarted.prepare(); await restarted.prepare();
  assert.equal(hooks, 1); assert.equal((await restarted.resolve()).instance.entries.email.revisions.length, 1);
  assert.equal(Object.keys((await restarted.resolve()).instance.pendingHooks!).length, 0);
});

test("resuming after a hook succeeds recovers its patch without running the effect twice", async () => {
  const { preparer, add } = await setup(); await add("name", "Ada"); await add("email", "ada@example.com");
  let hooks = 0;
  const { runner, adapter, config } = forms(preparer, { onEmail: () => { hooks++; return { patch: { name: "Ada Lovelace" } }; } });
  const original = adapter.commitInstance.bind(adapter); let crash = true;
  adapter.commitInstance = async (...args) => {
    if (crash && args[1].entries?.name?.append?.some(e => e.value === "Ada Lovelace")) { crash = false; throw new Error("interrupted before patch"); }
    return original(...args);
  };
  await assert.rejects(runner.start("intake"), /interrupted/); assert.equal(hooks, 1);
  const restarted = new FormRunner(adapter, config); await restarted.prepare(); await restarted.prepare();
  assert.equal(hooks, 1); const instance = (await restarted.resolve()).instance;
  assert.equal(inForce(instance.entries.name)!.value, "Ada Lovelace"); assert.equal(instance.entries.name.revisions.length, 2);
});
test("changing goal evidence asks for review without reopening or repeating achieved actions", async () => {
  const { preparer, add, facts } = await setup(); const old = await add("name", "Ada"); let completes = 0;
  const runner = new GoalRunner(new InMemoryGoalAdapter(), { scope: goalScope, preparation: { preparer, rule: () => rule }, hooks: { onComplete: () => { completes++; } } });
  await runner.start(program);
  await facts.record({ text: "Correction", value: { key: "name", value: "Ada Lovelace" }, source: { kind: "person", id: "Ada" }, verification: "verified" }, { operationId: "name-corrected", supersedes: old });
  const status = await runner.prepare(); assert.equal(status!.goals[0].status, "completed"); assert.equal(status!.preparation!.decisions[0].status, "review"); assert.equal(completes, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MemorySchema } from "../src/core/schema";
import { InMemoryFormAdapter } from "../src/in-memory/forms";
import { createSqliteMemoryAdapters } from "../src/sqlite";
import {
  compileForm, defineForm, evaluateForm, FormRegistry, FormRunner,
  type FormAdapter, type FormDef, type FormSkipExecutor,
} from "../src/forms";
import { buildFormReviseTool } from "../src/tools/forms/revise";
import { buildFormHistoryTool } from "../src/tools/forms/history";
import { renderView } from "../src/tools/forms/shared";

function definition(onSkip?: FormSkipExecutor<any>, onFill?: () => void) {
  return defineForm({ id: "contact", version: 1, name: "Contact", description: "Contact details" })
    .step("contact", { title: "Contact" }, s => s
      .field("website", { label: "Website", schema: z.url(), skippable: true, onSkip, onFill })
      .field("name", { label: "Name", schema: z.string().min(1) })
      .field("fallback", { label: "Fallback", schema: z.string().optional() }))
    .build();
}
function setup(def: FormDef<any> = definition(), adapter: FormAdapter = new InMemoryFormAdapter({ schema: new MemorySchema() })) {
  const registry = new FormRegistry().register(def.id, { name: def.name, description: def.description, load: () => def });
  const config = { registry, subject: "user" };
  return { runner: new FormRunner(adapter, config), adapter, config };
}

test("skip resolves required fields without values, preserves the reason, and runs skip then completion hooks", async () => {
  const calls: string[] = [];
  const def = definition(ctx => {
    calls.push(ctx.hookId);
    assert.equal(ctx.reason, "No website");
    assert.equal(ctx.state.complete, true);
    assert.equal("website" in ctx.values, false);
    return { patch: { fallback: "Use email" } };
  }, () => calls.push("fill"));
  def.steps[0].onComplete = () => { calls.push("step"); };
  def.onComplete = () => { calls.push("form"); };
  const { runner } = setup(def);
  await runner.start("contact", { seed: { name: "Ada" } });
  const result = await runner.skip("WEBSITE", "  No website  ");
  assert.equal(result.view.complete, true);
  const field = result.view.fields.find(f => f.id === "website")!;
  assert.equal(field.status, "skipped");
  assert.equal(field.skipReason, "No website");
  assert.equal(field.ask, false);
  assert.equal("value" in field, false);
  assert.deepEqual(calls, ["skip:website", "step", "form"]);
  const { compiled, instance } = await runner.resolve();
  assert.deepEqual(evaluateForm(compiled, instance).values, { name: "Ada", fallback: "Use email" });
  const outline = await runner.inspect({ scope: "outline" });
  assert.equal(outline.steps![0].filled, 1);
  assert.equal(outline.steps![0].skipped, 1);
  assert.equal((renderView(outline).steps as any[])[0].progress, "2/2");
  assert.deepEqual(result.aliased, [{ sent: "WEBSITE", resolved: "website" }]);
});

test("skips are opt-in even for optional fields, need a reason, and unknown fields remain self-correcting", async () => {
  const { runner } = setup();
  await runner.start("contact");
  await assert.rejects(runner.skip("name", "No name"), /does not allow skipping/);
  await assert.rejects(runner.skip("fallback", "Not needed"), /does not allow skipping/);
  await assert.rejects(runner.skip("website", "  "), /non-empty reason/);
  assert.equal((await runner.skip("websit", "No website")).unknown[0].didYouMean[0], "website");
  assert.deepEqual((await runner.resolve()).instance.entries, {});
});

test("skip history survives restart, undo, redo, replacement and retraction; repeated skips do not rerun effects", async () => {
  const keys: string[] = [];
  let fills = 0;
  const { runner, adapter, config } = setup(definition(ctx => { keys.push(ctx.idempotencyKey); }, () => { fills++; }));
  await runner.start("contact");
  await runner.skip("website", "No website");
  assert.match(await runner.tier0(), /skipped \(do not ask again\): Website \(No website\)/);
  assert.doesNotMatch(await runner.tier0(), /pending: Website/);
  await runner.skip("website", "Still no website");
  assert.equal(keys.length, 1);
  const restarted = new FormRunner(adapter, config);
  assert.equal((await restarted.history("website")).revisions[1].skipReason, "Still no website");
  await restarted.fill({ website: "https://example.com" });
  assert.equal(fills, 1);
  assert.match(renderView(await restarted.status()).undo_would as string, /skipped \(Still no website\)/);
  await restarted.undo();
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  await restarted.redo();
  assert.equal(fills, 2);
  await restarted.skip("website", "No longer online");
  await restarted.retract("website");
  assert.equal((await restarted.status()).fields[0].status, "empty");
  await restarted.undo();
  assert.equal((await restarted.status()).fields[0].skipReason, "No longer online");
  assert.equal((await restarted.history("website")).revisions.length, 5);
});

test("undo of a completion skip reopens the form and redo restores the skip", async () => {
  const { runner } = setup();
  await runner.start("contact", { seed: { name: "Ada" } });
  await runner.skip("website", "No website");
  assert.equal((await runner.undo()).view.status, "active");
  assert.match(renderView(await runner.status()).redo_would as string, /skipped \(No website\)/);
  assert.equal((await runner.redo()).view.status, "complete");
});

test("conditional skips are held without fake values and fire onSkip when they become applicable", async () => {
  let skips = 0;
  const def = defineForm({ id: "contact", version: 1, name: "Contact", description: "Conditional" })
    .step("contact", { title: "Contact" }, s => s
      .field("business", { label: "Business", schema: z.boolean() })
      .field("website", { label: "Website", schema: z.url(), skippable: true,
        when: v => v.business === true, onSkip: () => { skips++; } }))
    .build();
  const { runner } = setup(def);
  await runner.start("contact", { seed: { business: false } });
  await runner.skip("website", "No website");
  assert.equal(skips, 0);
  const held = (await runner.status()).fields[1];
  assert.equal(held.status, "held");
  assert.equal(held.skipReason, "No website");
  const { compiled, instance } = await runner.resolve();
  assert.deepEqual(evaluateForm(compiled, instance).held, {});
  await runner.fill({ business: true });
  assert.equal(skips, 1);
  assert.equal((await runner.status()).fields[1].status, "skipped");
  await runner.fill({ business: false });
  await runner.fill({ business: true });
  assert.equal(skips, 2);
});

test("skip tool and read-only history expose the reason with and without a registry", async () => {
  const { runner, adapter, config } = setup();
  await runner.start("contact");
  const tool = buildFormReviseTool(runner);
  const call = (input: any) => (tool.do as any)(input);
  assert.equal((await call({ action: "skip", field: "website" })).status, "error");
  assert.equal((await call({ action: "skip", field: "name", reason: "No name" })).status, "error");
  const result = await call({ action: "skip", field: "website", reason: "No website" });
  assert.equal(result.status, "success");
  assert.equal(result.data.fields[0].skip_reason, "No website");
  assert.equal(result.data.fields[0].skippable, true);
  const { instance } = await runner.resolve();
  for (const registry of [undefined, config.registry]) {
    const history = await (buildFormHistoryTool(adapter, { registry }).do as any)({ instance_id: instance.id });
    assert.equal("website" in history.data.values, false);
    if (registry) assert.equal(history.data.fields[0].skip_reason, "No website");
    else assert.deepEqual(history.data.skipped, { website: "No website" });
  }
});

test("SQLite retains skipped revisions and interrupted onSkip effects resume with the same reason and key", async t => {
  const directory = await mkdtemp(join(tmpdir(), "glove-form-skip-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "memory.sqlite");
  const create = () => createSqliteMemoryAdapters({ file, namespace: "skip", schema: new MemorySchema() }).forms;
  const adapter = create();
  const keys: string[] = [];
  const { runner, config } = setup(definition(ctx => {
    assert.equal(ctx.reason, "No website");
    keys.push(ctx.idempotencyKey);
    return { patch: { fallback: "Use email" } };
  }), adapter);
  await runner.start("contact");
  const record = adapter.recordDispatch.bind(adapter);
  adapter.recordDispatch = async (...args) => {
    if (args[2].status === "ok") throw new Error("Process interrupted after external effect");
    return record(...args);
  };
  await assert.rejects(runner.skip("website", "No website"), /Process interrupted/);
  const restarted = new FormRunner(create(), config);
  assert.equal((await restarted.status()).fields[0].status, "skipped");
  await restarted.resumeHooks();
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal((await restarted.status()).fields.find(f => f.id === "fallback")!.value, "Use email");
  assert.equal((await restarted.history("website")).revisions[0].skipReason, "No website");
  assert.deepEqual((await restarted.resolve()).instance.pendingHooks, {});
  await restarted.resumeHooks();
  assert.equal(keys.length, 2);
  await restarted.undo("website");
  assert.equal((await restarted.status()).fields[0].status, "empty");
  await restarted.redo("website");
  assert.equal((await restarted.status()).fields[0].status, "skipped");
});

test("a skip cannot satisfy a definition that no longer permits it", async () => {
  const { runner } = setup();
  await runner.start("contact", { seed: { name: "Ada" } });
  await runner.skip("website", "No website");
  const { instance } = await runner.resolve();
  const changed = definition();
  changed.steps[0].fields[0].skippable = false;
  const ev = evaluateForm(compileForm(changed), instance);
  assert.equal(ev.complete, false);
  assert.equal(ev.fields.get("website")!.status, "invalid");
  assert.match(ev.fields.get("website")!.error!, /no longer allows/);
});

test("an onSkip failure is surfaced without rolling back the skip or automatically retrying it", async () => {
  let calls = 0;
  const { runner } = setup(definition(() => { calls++; throw new Error("Follow-up unavailable"); }));
  await runner.start("contact");
  const result = await runner.skip("website", "No website");
  assert.equal(result.view.fields[0].status, "skipped");
  assert.equal(result.failures[0].hookId, "skip:website");
  assert.match(result.failures[0].message, /Follow-up unavailable/);
  await runner.resumeHooks();
  await runner.fill({ name: "Ada" });
  assert.equal(calls, 1);
});

test("skips open subsequent steps and onSkip can jump back without prompting skipped fields again", async () => {
  const def = defineForm({ id: "contact", version: 1, name: "Contact", description: "Contact" })
    .step("website", { title: "Website" }, s => s.field("website", {
      label: "Website", schema: z.url(), skippable: true, onSkip: () => ({ jump: "website" }),
    }))
    .step("details", { title: "Details", when: (_v, state) => state.stepComplete("website") }, s => s
      .field("name", { label: "Name", schema: z.string() }))
    .build();
  const { runner } = setup(def);
  await runner.start("contact");
  const result = await runner.skip("website", "No website");
  assert.equal(result.view.revisiting, true);
  assert.equal(result.view.fields[0].ask, false);
  assert.equal((await runner.inspect({ scope: "outline" })).steps![1].open, true);
  await runner.fill({ name: "Ada" });
  assert.equal((await runner.status()).complete, true);
});

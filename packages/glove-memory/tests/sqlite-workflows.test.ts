import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFile, fork } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FactStore, type FactTransaction } from "glove-facts";
import { createSqliteMemoryAdapters } from "../src/sqlite/index";
import { GoalRunner, GoalConflictError } from "../src/goals/index";
import { FormConflictError } from "../src/core/errors";
import { schema, provenance } from "./fixtures/sqlite-worker";

const program = { key: "intake", goals: [{ key: "identity", title: "Identity", objective: "Collect identity", items: [{ key: "name", label: "Name" }] }] };
const scope = { subject: "customer", key: program.key };
const factScope = { subject: scope.subject, context: "intake" };
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "glove-workflow-sqlite-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "memory.sqlite");
  return { file, create: (namespace = "owner") => createSqliteMemoryAdapters({ file, namespace, schema }) };
}

test("goals persist revisions, CAS conflicts, and owner-fenced hook receipts", async t => {
  const { create } = await setup(t);
  const first = create();
  const runner = new GoalRunner(first.goals, { scope });
  await runner.start(program);
  await runner.update({ goalKey: program.goals[0].key, completed: [program.goals[0].items[0].key], reason: "Confirmed" });
  const restored = new GoalRunner(create().goals, { scope });
  await restored.start(program);
  assert.equal((await restored.status())?.status, "completed");
  assert.equal((await restored.history()).length, 2);
  const saved = (await create().goals.get(scope))!;
  await assert.rejects(create().goals.commit(scope, saved, { ifVersion: 1 }), GoalConflictError);
  const id = saved.history[0].transitions![0].id;
  assert.equal(await first.goals.claimTransition(scope, id, { owner: "first", leaseMs: 10000 }), "claimed");
  assert.equal(await create().goals.claimTransition(scope, id, { owner: "second", leaseMs: 10000 }), "busy");
  assert.equal(await create().goals.settleTransition(scope, id, { owner: "second", state: "completed" }), false);
  assert.equal(await create().goals.settleTransition(scope, id, { owner: "first", state: "completed" }), true);
  assert.equal((await create().goals.getTransitionDispatches(scope))[0].state, "completed");
  assert.equal(await create("other").goals.get(scope), null);
});

test("forms preserve answer history, pending effects, receipts and checkpoint recovery", async t => {
  const { create } = await setup(t);
  const initial = await create().forms.createInstance({ defId: "intake", defVersion: 1, subject: scope.subject }, provenance);
  await create().forms.commitInstance(initial.id, {
    entries: { name: { append: [{ value: "Mira", seq: 1, at: provenance.timestamp, provenance }], cursor: 0 } },
    revisionSeq: 1, status: "awaiting", blockedOn: "review",
    pendingHooks: { batch: { id: "batch", defVersion: 1, hooks: [], values: { name: "Mira" }, live: ["name"], stepComplete: {}, complete: false, priorOccurrences: {}, newFields: ["name"], provenance } },
  }, { ifVersion: 1 }, provenance);
  await assert.rejects(create().forms.commitInstance(initial.id, {}, { ifVersion: 1 }, provenance), FormConflictError);
  await create().forms.recordDispatch(initial.id, "effect", { hookId: "review", status: "ok", attempts: 1, at: provenance.timestamp, effects: [] }, provenance);
  const restored = (await create().forms.getInstance(initial.id))!;
  assert.equal(restored.entries.name.revisions[0].value, "Mira");
  assert.ok(restored.pendingHooks?.batch);
  assert.equal(restored.dispatches.effect.status, "ok");
  const resolved = await create().forms.resolveCheckpoint(initial.id, "review", { ok: true }, provenance);
  assert.equal(resolved.status, "active");
  assert.equal(resolved.blockedOn, undefined);
  assert.equal(await create("other").forms.getInstance(initial.id), null);
});

test("independent workers serialize facts and a killed lock owner releases without losing saved state", { timeout: 30000 }, async t => {
  const { file, create } = await setup(t);
  const fixture = fileURLToPath(new URL("./fixtures/sqlite-facts-worker.ts", import.meta.url));
  const worker = (id: string) => promisify(execFile)(process.execPath, ["--import", "tsx", fixture, "append", file, id], { timeout: 15000 });
  await Promise.all([worker("a"), worker("b"), worker("c")]);
  const facts = new FactStore(create().facts, { scope: factScope });
  assert.equal((await facts.list()).length, 15);
  const child = fork(fixture, ["hold", file], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const [message] = await once(child, "message");
  assert.equal(message, "saved-and-locked");
  child.kill("SIGKILL");
  await once(child, "exit");
  assert.equal((await facts.inspect()).version, 16);
  await worker("after-death");
  assert.equal((await facts.list()).length, 20);
});

test("facts keep each save after callback failure and can commit consumers under their lock", async t => {
  const { create } = await setup(t);
  let expired!: FactTransaction;
  await assert.rejects(create().facts.withScope(factScope, async tx => {
    expired = tx;
    const state = await tx.read();
    await tx.save({ ...state, version: 1 });
    await new GoalRunner(create().goals, { scope }).start(program);
    throw new Error("consumer failed after save");
  }), /consumer failed/);
  assert.equal(await create().facts.withScope(factScope, async tx => (await tx.read()).version), 1);
  await assert.rejects(async () => expired.read(), /Expired/);
  assert.equal((await create().goals.get(scope))?.version, 1);
  const store = () => new FactStore(create().facts, { scope: factScope });
  const captured = await store().record({ text: "Name is Mira", source: { kind: "message", id: "message" } }, { operationId: "capture" });
  const duplicate = await store().record({ text: "Name is Mira", source: { kind: "message", id: "message" } }, { operationId: "capture" });
  assert.equal(captured.id, duplicate.id);
  await Promise.all(Array.from({ length: 8 }, (_, i) => store().record({ text: `Fact ${i}`, source: { kind: "message", id: String(i) } }, { operationId: String(i) })));
  assert.equal((await store().list()).length, 9);
  assert.equal((await new FactStore(create("other").facts, { scope: factScope }).list()).length, 0);
});

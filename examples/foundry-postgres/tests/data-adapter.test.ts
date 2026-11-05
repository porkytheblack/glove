/**
 * The FoundryDataAdapter contract, checked against a real PostgreSQL server.
 * Copy these checks for an adapter of your own: the atomic ones (claims,
 * provisioning, compare-and-set) are where a database adapter goes wrong.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Effect } from "effect";
import pg from "pg";
import {
  createAgentInstance,
  createConversation,
  scheduleOccurrenceId,
  type FoundryEventReceipt,
  type FoundryEventRecord,
  type FoundryScheduleOccurrence,
} from "glove-foundry";
import { migrate, PostgresFoundryDataAdapter } from "../src/postgres-data.js";
import { PostgresStore } from "../src/postgres-store.js";
import { startDatabase, type TestDatabase } from "./database.js";

// Started before the tests are declared, so a missing server can skip them.
const database: TestDatabase | null = await startDatabase();
const pools: pg.Pool[] = [];
const newPool = () => { const pool = new pg.Pool({ connectionString: database!.url, max: 4 }); pools.push(pool); return pool; };
const adapter = () => new PostgresFoundryDataAdapter({ pool: newPool() });
const runs = <A>(effect: Effect.Effect<A, unknown, never>) => Effect.runPromise(effect);

before(async () => {
  if (database) await migrate(newPool());
});
after(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  await database?.stop();
});

const skip = () => (database ? false : "PostgreSQL is not available: set DATABASE_URL or install initdb");
const now = () => new Date().toISOString();

test("documents round-trip exactly, key order included", { skip: skip() }, async () => {
  const data = adapter();
  const agent = createAgentInstance("assistant", { id: "agent_order", workspaceId: "w1", context: { zebra: 1, apple: { y: 2, x: 1 } } });
  await runs(data.putAgent(agent));
  const stored = await runs(data.getAgent("agent_order"));
  assert.equal(JSON.stringify(stored?.context), JSON.stringify({ zebra: 1, apple: { y: 2, x: 1 } }), "json, not jsonb: keys keep their order");
  const conversation = createConversation(agent, { id: "conversation_order", workspaceId: "w1" });
  await runs(data.putConversation(conversation));
  assert.deepEqual((await runs(data.listConversations(agent.id))).map((item) => item.id), ["conversation_order"]);
  assert.deepEqual((await runs(data.listAgents("assistant"))).map((item) => item.id), ["agent_order"]);
  assert.deepEqual(await runs(data.listAgents("other")), []);
});

test("provisioning is atomic on its key across connections", { skip: skip() }, async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () =>
    runs(adapter().provisionAgent({ definitionId: "assistant", provisioningKey: "ticket:T-1", workspaceId: "w1" }))));
  assert.equal(new Set(results.map((agent) => agent.id)).size, 1, "one instance for one key");
  await assert.rejects(runs(adapter().provisionAgent({ definitionId: "assistant", provisioningKey: "ticket:T-2", workspaceId: "w1", id: results[0]!.id })));
});

test("every claim is insert-if-absent under concurrency", { skip: skip() }, async () => {
  const many = <A>(make: () => Effect.Effect<A, unknown, never>) => Promise.all(Array.from({ length: 8 }, () => runs(make())));
  const wins = (results: ReadonlyArray<unknown>) => results.filter((value) => value === true).length;

  assert.equal(wins(await many(() => adapter().claimInboundDelivery("slack:E1:agent"))), 1);

  const agent = createAgentInstance("assistant", { id: "agent_claims", workspaceId: "w1" });
  await runs(adapter().putAgent(agent));
  const event: FoundryEventRecord = {
    id: "event_1", target: { agentId: agent.id, conversationId: "c1" }, definitionId: "assistant", workspaceId: "w1",
    event: { id: "e1", source: "test", content: "hello" }, policy: {}, delivery: { kind: "agent-message", pendingId: "event_1", message: "hello" },
    status: "pending", createdAt: now(),
  };
  assert.equal(wins(await many(() => adapter().claimEvent(event))), 1);

  const occurrence: FoundryScheduleOccurrence = {
    id: scheduleOccurrenceId("activation_1", "revision", "2026-11-03T06:00:00.000Z"), activationId: "activation_1", revision: "revision",
    scheduledFor: "2026-11-03T06:00:00.000Z", definitionId: "assistant", agentId: agent.id, conversationId: "c1", workspaceId: "w1",
    request: { agentId: agent.id, conversationId: "c1", workspaceId: "w1", message: "remind" }, status: "pending", attempts: 0,
    createdAt: now(), updatedAt: now(),
  };
  assert.equal(wins(await many(() => adapter().claimScheduleOccurrence(occurrence))), 1);

  const receipt: FoundryEventReceipt = {
    id: "event_1", eventId: "e1", agentId: agent.id, conversationId: "c1", workspaceId: "w1", status: "queued", createdAt: now(), updatedAt: now(),
  };
  assert.equal(wins(await many(() => adapter().claimEventReceipt(receipt))), 1);
});

test("compare-and-set lets exactly one writer advance a workspace entry", { skip: skip() }, async () => {
  const first = { workspaceId: "w1", key: "counter", value: 0, updatedAt: "2026-11-05T10:00:00.000Z" };
  assert.equal(await runs(adapter().compareAndSetWorkspaceEntry(first, null)), true);
  assert.equal(await runs(adapter().compareAndSetWorkspaceEntry(first, null)), false, "absent is required");
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => runs(adapter().compareAndSetWorkspaceEntry(
    { ...first, value: index + 1, updatedAt: `2026-11-05T10:00:0${index + 1}.000Z` }, first.updatedAt))));
  assert.equal(results.filter(Boolean).length, 1);
  await assert.rejects(runs(adapter().compareAndSetWorkspaceEntry({ ...first, updatedAt: "2026-11-05T09:00:00.000Z" }, first.updatedAt)), /advance/);
});

test("inbound claims complete or release as the contract says", { skip: skip() }, async () => {
  const data = adapter();
  await assert.rejects(runs(data.completeInboundDelivery("missing", [])));
  assert.equal(await runs(data.claimInboundDelivery("route:E2:agent")), true);
  await runs(data.releaseInboundDelivery("route:E2:agent"));
  assert.equal(await runs(data.claimInboundDelivery("route:E2:agent")), true, "a released pending claim can be taken again");
  await runs(data.completeInboundDelivery("route:E2:agent", ["run_1"]));
  await runs(data.releaseInboundDelivery("route:E2:agent"));
  assert.equal((await runs(data.getInboundDelivery("route:E2:agent")))?.status, "completed", "a completed claim is never released");
});

test("occurrences and receipts filter and order as Foundry reads them", { skip: skip() }, async () => {
  const data = adapter();
  const base = {
    activationId: "activation_order", revision: "r", definitionId: "assistant", agentId: "agent_x", conversationId: "c", workspaceId: "w2",
    request: { agentId: "agent_x", conversationId: "c", workspaceId: "w2", message: "m" }, attempts: 0, createdAt: now(), updatedAt: now(),
  };
  for (const [at, status] of [["2026-11-05T08:00:00.000Z", "completed"], ["2026-11-05T06:00:00.000Z", "pending"], ["2026-11-05T07:00:00.000Z", "accepted"]] as const) {
    await runs(data.putScheduleOccurrence({ ...base, id: scheduleOccurrenceId(base.activationId, "r", at), scheduledFor: at, status }));
  }
  const all = await runs(data.listScheduleOccurrences({ activationId: "activation_order" }));
  assert.deepEqual(all.map((item) => item.scheduledFor), ["2026-11-05T06:00:00.000Z", "2026-11-05T07:00:00.000Z", "2026-11-05T08:00:00.000Z"]);
  assert.deepEqual((await runs(data.listScheduleOccurrences({ status: ["pending", "accepted"], workspaceId: "w2" }))).map((item) => item.status), ["pending", "accepted"]);
  await runs(data.putEventReceipt({ id: "r1", eventId: "e", agentId: "agent_x", conversationId: "c", workspaceId: "w2", status: "accepted", createdAt: now(), updatedAt: now() }));
  assert.equal((await runs(data.listEventReceipts({ agentId: "agent_x", status: "accepted" }))).length, 1);
  assert.equal((await runs(data.listEventReceipts({ status: "queued", conversationId: "c" }))).length, 0);
});

test("purging an archived worker removes what it owns in one transaction and keeps a tombstone", { skip: skip() }, async () => {
  const data = adapter();
  const worker = createAgentInstance("assistant/workers/research", {
    id: "worker_purge", workspaceId: "w3",
    durableSubagent: { parentAgentId: "agent_parent", name: "research", status: "archived", createdAt: now() } as never,
  });
  await runs(data.putAgent(worker));
  const conversation = createConversation(worker, { id: "conversation_purge", workspaceId: "w3" });
  await runs(data.putConversation(conversation));
  await runs(data.putTask({ id: "task_purge", workspaceId: "w3", conversationId: conversation.id, title: "t", status: "open", createdAt: now(), updatedAt: now() }));
  await runs(data.putTask({ id: "task_keep", workspaceId: "w3", title: "keep", status: "open", createdAt: now(), updatedAt: now() }));
  await runs(data.purgeAgentData!(worker.id));
  assert.equal((await runs(data.getAgent(worker.id)))?.durableSubagent?.status, "purged");
  assert.deepEqual(await runs(data.listConversations(worker.id)), []);
  assert.deepEqual((await runs(data.listTasks("w3"))).map((task) => task.id), ["task_keep"]);
  const live = createAgentInstance("assistant", { id: "agent_live", workspaceId: "w3" });
  await runs(data.putAgent(live));
  await assert.rejects(runs(data.purgeAgentData!(live.id)), /archived/);
});

test("the transcript store keeps order, counters and per-input permissions", { skip: skip() }, async () => {
  const pool = newPool();
  const store = new PostgresStore(pool, "conversation_store");
  await store.appendMessages([{ sender: "user", text: "one" }, { sender: "agent", text: "two" }]);
  await store.appendMessages([{ sender: "user", text: "three", framework_context: "event", id: "m3" }]);
  assert.deepEqual((await new PostgresStore(newPool(), "conversation_store").getMessages()).map((item) => item.text), ["one", "two", "three"]);
  await store.addTokens({ tokens_in: 3, tokens_out: 4 });
  await store.incrementTurn();
  assert.equal(await store.getTokenCount(), 7);
  assert.equal(await store.getTurnCount(), 1);
  await store.resetCounters();
  assert.equal(await store.getTokenCount(), 0);
  await store.setPermission("send", "granted", { to: "lena" });
  assert.equal(await store.getPermission("send", { to: "lena" }), "granted");
  assert.equal(await store.getPermission("send", { to: "maya" }), "unset");
  await store.setPermission("send", "unset", { to: "lena" });
  assert.equal(await store.getPermission("send", { to: "lena" }), "unset");
});

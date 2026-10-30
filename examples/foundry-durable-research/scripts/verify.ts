import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { FileFoundryDataAdapter, FoundryRuntime } from "glove-foundry";
import { openRoom } from "../lib/room.js";

// No model is called, no API key is read, and no user data is changed.
const temporary = await mkdtemp(join(tmpdir(), "durable-research-example-"));
process.env.RESEARCH_DATA_DIR = temporary;
const { default: application } = await import("../foundry.application.js");
const { FileStore } = await import("../lib/file-store.js");
const runtime = await FoundryRuntime.discover({
  rootDir: fileURLToPath(new URL("../", import.meta.url)),
  agentsDir: fileURLToPath(new URL("../agents/", import.meta.url)), application,
});
try {
  const front = runtime.agents.find((agent) => agent.route === "front")!.definition;
  const researcher = runtime.agents.find((agent) => agent.route === "front/workers/research")!.definition;
  assert.equal(researcher.runTimeoutMs, 4 * 60 * 60 * 1000);
  assert.deepEqual(researcher.eventDelivery, { whenIdle: "defer", deferTimeoutMs: 30_000 });
  assert.deepEqual(researcher.components!.capabilities.applications[0]!.restrictions?.tools, ["read_document"]);
  assert.deepEqual(front.durableSubagents!.research!.inherit!.memory, { scope: "shared", access: "reader", profiles: ["personal"] });
  const parent = await runtime.createAgent("front", { id: "offline-parent", context: { preference: "EU" }, installations: [{ kind: "application", id: "library" }] });
  const worker = await runtime.subagent(parent.id, "research");
  assert.equal(worker.context.preference, "EU");
  assert.equal((await runtime.subagent(parent.id, "research")).id, worker.id);
  const receipt = await runtime.messageSubagent(parent.id, "research", "deferred test", { id: "verify-event", whenIdle: "defer" });
  assert.equal(receipt.runId, undefined);
  assert.equal((await Effect.runPromise(runtime.data.listEvents!()))[0]!.status, "pending");
  const store = await FileStore.open("verify-transcript");
  await Promise.all([
    store.appendMessages([{ sender: "user", text: "remember this" }]),
    store.addTokens({ tokens_in: 12, tokens_out: 3 }),
    store.incrementTurn(),
  ]);
  const reopened = await FileStore.open("verify-transcript");
  assert.equal((await reopened.getMessages())[0]!.text, "remember this");
  assert.equal((await reopened.getTokenConsumption()).tokens_in, 12);
  assert.equal(await reopened.getTurnCount(), 1);
  await FileStore.remove("verify-transcript");
  assert.equal((await (await FileStore.open("verify-transcript")).getMessages()).length, 0);

  // Reconstruct the runtime with a fresh adapter, without starting model execution.
  await runtime.stop();
  const recovered = await FoundryRuntime.discover({
    rootDir: fileURLToPath(new URL("../", import.meta.url)),
    agentsDir: fileURLToPath(new URL("../agents/", import.meta.url)),
    application: { ...application, data: new FileFoundryDataAdapter({ file: join(temporary, "foundry.json") }) },
  });
  try {
    assert.equal((await recovered.subagent(parent.id, "research")).id, worker.id);
    const events = await Effect.runPromise(recovered.data.listEvents!());
    assert.equal(events[0]!.event.id, "verify-event");
    assert.equal(events[0]!.status, "pending");
    assert.equal(events[0]!.target.conversationId, receipt.conversationId);
  } finally { await recovered.stop(); }

  const said: string[] = []; let ended = false;
  const room = await openRoom({ say: async (text) => { said.push(text); } }, "offline-test-token", () => { ended = true; }, 0);
  try {
    const base = `http://127.0.0.1:${room.port}`;
    assert.match(await (await fetch(base)).text(), /Realtime research front/);
    assert.equal((await fetch(`${base}/say`, { method: "POST" })).status, 401);
    const headers = { authorization: "Bearer offline-test-token", "content-type": "application/json" };
    const stream = await fetch(`${base}/events`, { headers });
    const reader = stream.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /Connected/);
    room.publish("assistant", "A finding arrived.");
    assert.match(new TextDecoder().decode((await reader.read()).value), /A finding arrived/);
    await reader.cancel();
    assert.equal((await fetch(`${base}/say`, { method: "POST", headers, body: JSON.stringify({ text: "Research Atlas" }) })).status, 202);
    assert.deepEqual(said, ["Research Atlas"]);
    await fetch(`${base}/end`, { method: "POST", headers }); assert.equal(ended, true);
  } finally { await room.close(); }
  console.log("Durable research example verified offline: discovery, inheritance, event persistence, transcripts and room transport.");
} finally { await runtime.stop(); await rm(temporary, { recursive: true, force: true }); }

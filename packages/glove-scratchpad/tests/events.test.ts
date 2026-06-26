import { test } from "node:test";
import assert from "node:assert/strict";
import { Scratchpad } from "../src/core/scratchpad";
import { MemoryBackend } from "../src/backends/memory";
import { createScratchpadStats, type ScratchpadEvent } from "../src/core/events";

async function sp(): Promise<Scratchpad> {
  return Scratchpad.create(await MemoryBackend.create());
}

test("emits ingest / query / materialize / drop / snapshot events", async () => {
  const s = await sp();
  const events: ScratchpadEvent[] = [];
  s.subscribe({ record: (e) => void events.push(e) });

  const stub = await s.ingest([{ id: 1, v: "a" }, { id: 2, v: "b" }], { name: "rows", provenance: { source: "tool:x", actor: "me" } });
  await s.query(`SELECT * FROM ${stub.ref} WHERE id = 1`, { store: "one" });
  await s.materialize({ ref: "one" });
  await s.drop("one");
  await s.snapshot();

  const types = events.map((e) => e.type);
  assert.deepEqual(types, ["ingest", "query", "materialize", "drop", "snapshot"]);

  const ingest = events[0] as Extract<ScratchpadEvent, { type: "ingest" }>;
  assert.equal(ingest.ref, stub.ref);
  assert.equal(ingest.rowCount, 2);
  assert.equal(ingest.source, "tool:x");
  assert.equal(ingest.actor, "me");
  assert.ok(ingest.bytes > 0);

  const query = events[1] as Extract<ScratchpadEvent, { type: "query" }>;
  assert.equal(query.stored, "one");
  assert.equal(query.rows, 1);

  const mat = events[2] as Extract<ScratchpadEvent, { type: "materialize" }>;
  assert.equal(mat.ref, "one");
  assert.equal(mat.returned, 1);

  for (const e of events) assert.ok(typeof (e as { durationMs?: number }).durationMs === "number");
  await s.close();
});

test("emits an error event (and rethrows) on bad SQL", async () => {
  const s = await sp();
  const events: ScratchpadEvent[] = [];
  s.subscribe({ record: (e) => void events.push(e) });

  await assert.rejects(() => s.materialize({ sql: "DELETE FROM whatever" }));
  const err = events.find((e) => e.type === "error") as Extract<ScratchpadEvent, { type: "error" }> | undefined;
  assert.ok(err, "an error event should be emitted");
  assert.equal(err!.op, "materialize");
  await s.close();
});

test("unsubscribe stops delivery", async () => {
  const s = await sp();
  const events: ScratchpadEvent[] = [];
  const off = s.subscribe({ record: (e) => void events.push(e) });
  await s.ingest([{ id: 1 }], { name: "a" });
  off();
  await s.ingest([{ id: 2 }], { name: "b" });
  assert.equal(events.length, 1);
  await s.close();
});

test("a throwing subscriber never breaks the store", async () => {
  const s = await sp();
  s.subscribe({ record: () => { throw new Error("boom"); } });
  // Should not reject despite the bad subscriber.
  const stub = await s.ingest([{ id: 1 }], { name: "ok" });
  assert.ok(stub.ref);
  await s.close();
});

test("createScratchpadStats tallies the stream", async () => {
  const s = await sp();
  const stats = createScratchpadStats();
  s.subscribe(stats.subscriber);

  const stub = await s.ingest([{ id: 1 }, { id: 2 }, { id: 3 }], { name: "t" });
  await s.query(`SELECT * FROM ${stub.ref}`, { store: "all" });
  await s.materialize({ ref: "all" });

  const out = stats.stats();
  assert.equal(out.ingests, 1);
  assert.equal(out.queries, 1);
  assert.equal(out.materializes, 1);
  assert.equal(out.rowsMaterialized, 3);
  assert.ok(out.bytesIngested > 0);
  assert.match(stats.format(), /1 ingest/);

  stats.reset();
  assert.equal(stats.stats().ingests, 0);
  await s.close();
});

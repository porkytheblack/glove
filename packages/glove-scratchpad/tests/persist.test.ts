import { test } from "node:test";
import assert from "node:assert/strict";
import { Scratchpad } from "../src/core/scratchpad";
import { MemoryBackend } from "../src/backends/memory";
import {
  MemoryScratchpadStore,
  persistScratchpad,
  restoreScratchpad,
  autoPersistScratchpad,
} from "../src/persist/index";

async function freshSp(): Promise<Scratchpad> {
  return Scratchpad.create(await MemoryBackend.create());
}

test("MemoryScratchpadStore roundtrips and deletes", async () => {
  const store = new MemoryScratchpadStore();
  assert.equal(await store.load("k"), null);
  await store.save("k", new Uint8Array([1, 2, 3]));
  assert.deepEqual([...(await store.load("k"))!], [1, 2, 3]);
  await store.delete("k");
  assert.equal(await store.load("k"), null);
});

test("persist → restore preserves the whole scratchpad", async () => {
  const sp = await freshSp();
  const store = new MemoryScratchpadStore();
  const stub = await sp.ingest([{ id: 1, v: "a" }, { id: 2, v: "b" }, { id: 3, v: "c" }], { name: "rows" });
  await sp.query(`SELECT * FROM ${stub.ref} WHERE id > 1`, { store: "kept" });

  await persistScratchpad(sp, store, "session-1");
  await sp.close();

  const restored = await restoreScratchpad({ store, key: "session-1" });
  assert.ok(restored, "restore should return a scratchpad");
  const rows = await restored!.materialize({ ref: "kept" });
  assert.equal(rows.returned, 2);
  const refs = (await restored!.list()).map((r) => r.ref).sort();
  assert.deepEqual(refs, ["kept", "rows"]);
  await restored!.close();
});

test("restoreScratchpad returns null when nothing is stored", async () => {
  const store = new MemoryScratchpadStore();
  assert.equal(await restoreScratchpad({ store, key: "missing" }), null);
});

test("autoPersistScratchpad saves on mutation and resumes the data", async () => {
  const sp = await freshSp();
  const store = new MemoryScratchpadStore();
  const stop = autoPersistScratchpad(sp, { store, key: "auto", debounceMs: 10_000 });

  const stub = await sp.ingest([{ id: 1 }, { id: 2 }], { name: "data" });
  await stop(); // flushes the pending mutation deterministically

  const restored = await restoreScratchpad({ store, key: "auto" });
  assert.ok(restored);
  const rows = await restored!.materialize({ ref: stub.ref });
  assert.equal(rows.returned, 2);
  await sp.close();
  await restored!.close();
});

test("autoPersist coalesces a burst of mutations into one save", async () => {
  const sp = await freshSp();
  const store = new MemoryScratchpadStore();
  let saves = 0;
  // Large debounce so no timer fires mid-test; stop() flushes exactly once.
  const stop = autoPersistScratchpad(sp, { store, key: "burst", debounceMs: 10_000, onPersist: () => saves++ });

  await sp.ingest([{ id: 1 }], { name: "a" });
  await sp.ingest([{ id: 2 }], { name: "b" });
  await sp.ingest([{ id: 3 }], { name: "c" });
  await stop();

  assert.equal(saves, 1, "three rapid mutations should coalesce into a single save");
  await sp.close();
});

test("autoPersist ignores read-only ops (no save without a mutation)", async () => {
  const sp = await freshSp();
  const store = new MemoryScratchpadStore();
  let saves = 0;
  await sp.ingest([{ id: 1 }], { name: "seed" }); // before auto-persist starts
  const stop = autoPersistScratchpad(sp, { store, key: "ro", debounceMs: 10_000, onPersist: () => saves++ });

  await sp.materialize({ ref: "seed" }); // read-only
  await sp.query(`SELECT * FROM seed`); // read-only (no store)
  await stop();

  assert.equal(saves, 0, "read-only ops must not trigger a save");
  await sp.close();
});

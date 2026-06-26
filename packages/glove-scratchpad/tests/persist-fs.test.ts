import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { Scratchpad } from "../src/core/scratchpad";
import { MemoryBackend } from "../src/backends/memory";
import { persistScratchpad, restoreScratchpad } from "../src/persist/index";
import { FsScratchpadStore } from "../src/persist/fs";

test("FsScratchpadStore persists a scratchpad to disk and restores it", async () => {
  const dir = join(tmpdir(), "glove-scratchpad-persist-test");
  await rm(dir, { recursive: true, force: true });
  const store = new FsScratchpadStore(dir);

  try {
    const sp = await Scratchpad.create(await MemoryBackend.create());
    const stub = await sp.ingest([{ id: 1, v: "x" }, { id: 2, v: "y" }], { name: "rows" });
    await persistScratchpad(sp, store, "sess/with slash"); // key gets encoded into the filename
    await sp.close();

    const restored = await restoreScratchpad({ store, key: "sess/with slash" });
    assert.ok(restored);
    const rows = await restored!.materialize({ ref: stub.ref });
    assert.equal(rows.returned, 2);
    await restored!.close();

    await store.delete("sess/with slash");
    assert.equal(await store.load("sess/with slash"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

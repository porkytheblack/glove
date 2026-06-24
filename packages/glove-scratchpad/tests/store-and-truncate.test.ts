import { test } from "node:test";
import assert from "node:assert/strict";
import type { GloveFoldArgs } from "glove-core/glove";
import { Scratchpad } from "../src/core/scratchpad";
import { PgliteBackend } from "../src/backends/pglite";
import { storeAndTruncate } from "../src/tools/store-and-truncate";

// §3, §11 — result containment. A tool's large payload is written to the store
// and only a stub crosses back into the model's context.
test("storeAndTruncate replaces a large payload with a small stub", async () => {
  const sp = await Scratchpad.create(await PgliteBackend.create());

  const big = Array.from({ length: 200 }, (_, i) => ({
    id: i,
    name: `item-${i}`,
    score: i * 1.5,
  }));
  const rawString = JSON.stringify(big);

  const tool: GloveFoldArgs<Record<string, never>> = {
    name: "search",
    description: "fake search returning a big JSON payload",
    async do() {
      return { status: "success", data: rawString };
    },
  };

  const wrapped = storeAndTruncate(tool, { scratchpad: sp, actor: "searcher" });
  const result = await wrapped.do({}, undefined as never, undefined as never);

  assert.equal(result.status, "success");
  const data = result.data as {
    scratchpad: boolean;
    ref: string;
    rowCount: number;
    provenance: { source: string; actor?: string };
  };
  assert.equal(data.scratchpad, true);
  assert.equal(data.rowCount, 200);
  assert.equal(data.provenance.actor, "searcher");
  assert.match(data.provenance.source, /^tool:search/);

  // The model now sees a stub far smaller than the raw payload.
  const stubBytes = JSON.stringify(result.data).length;
  assert.ok(
    stubBytes < rawString.length / 5,
    `stub (${stubBytes}b) should be far smaller than payload (${rawString.length}b)`,
  );

  // Full payload is still recoverable from the store, and the client-only
  // renderData carries the original.
  assert.equal(result.renderData, rawString);
  const all = await sp.materialize({ ref: data.ref, limit: 1000 });
  assert.equal(all.returned, 200);
  assert.equal(all.rows[4].name, "item-4");
  await sp.close();
});

test("storeAndTruncate passes through small payloads under minBytes", async () => {
  const sp = await Scratchpad.create(await PgliteBackend.create());
  const tool: GloveFoldArgs<Record<string, never>> = {
    name: "tiny",
    description: "small result",
    async do() {
      return { status: "success", data: "ok" };
    },
  };
  const wrapped = storeAndTruncate(tool, { scratchpad: sp, minBytes: 1000 });
  const result = await wrapped.do({}, undefined as never, undefined as never);
  assert.equal(result.data, "ok"); // untouched
  await sp.close();
});

test("storeAndTruncate leaves error results untouched", async () => {
  const sp = await Scratchpad.create(await PgliteBackend.create());
  const tool: GloveFoldArgs<Record<string, never>> = {
    name: "boom",
    description: "always errors",
    async do() {
      return { status: "error", message: "nope", data: null };
    },
  };
  const wrapped = storeAndTruncate(tool, { scratchpad: sp });
  const result = await wrapped.do({}, undefined as never, undefined as never);
  assert.equal(result.status, "error");
  assert.equal(result.data, null);
  await sp.close();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { Scratchpad } from "../src/core/scratchpad";
import { MemoryBackend } from "../src/backends/memory";
import { createConsumptionTracker } from "../src/core/events";

async function sp(): Promise<Scratchpad> {
  return Scratchpad.create(await MemoryBackend.create());
}

test("tracks tokens into context vs tokens contained", async () => {
  const s = await sp();
  const c = createConsumptionTracker();
  s.subscribe(c.subscriber);

  const big = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `row-${i}`, v: i * 1.5 }));
  const stub = await s.ingest(big, { name: "rows" });

  let r = c.report();
  assert.ok(r.tokensContained > 0, "payload contained → contained tokens > 0");
  assert.ok(r.byOp.stubs > 0, "a stub crosses into context");
  assert.ok(r.tokensContained > r.tokensIntoContext, "containment saves far more than the stub costs");
  assert.ok(r.reductionFactor > 1);

  // materialize a few rows → in-context grows under "materializes"
  const beforeM = c.report().byOp.materializes;
  await s.materialize({ ref: stub.ref, limit: 5 });
  assert.ok(c.report().byOp.materializes > beforeM, "materialize adds in-context tokens");

  // read-mode query → grows under "queryReads"
  const beforeQ = c.report().byOp.queryReads;
  await s.query(`SELECT id FROM ${stub.ref} LIMIT 3`);
  assert.ok(c.report().byOp.queryReads > beforeQ);

  assert.match(c.format(), /tokens into context/);
  await s.close();
});

test("tokensForBytes override changes the estimate (1 token = 1 byte)", async () => {
  const s = await sp();
  const c = createConsumptionTracker((bytes) => bytes);
  s.subscribe(c.subscriber);
  await s.ingest([{ a: 1, b: 2 }], { name: "x" });
  const r = c.report();
  assert.equal(r.tokensContained, r.bytesContained);
  assert.equal(r.tokensIntoContext, r.bytesIntoContext);
  await s.close();
});

test("reset zeroes the counters", async () => {
  const s = await sp();
  const c = createConsumptionTracker();
  s.subscribe(c.subscriber);
  await s.ingest([{ a: 1 }], { name: "x" });
  c.reset();
  assert.equal(c.report().tokensContained, 0);
  assert.equal(c.report().tokensIntoContext, 0);
  await s.close();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import { Scratchpad } from "../src/core/scratchpad";
import { MemoryBackend } from "../src/backends/memory";
import { createContainmentReporter } from "../src/tools/store-and-truncate";
import { containTools, mountContainedTools } from "../src/tools/contain";

function bigTool(name: string): GloveFoldArgs<Record<string, never>> {
  const payload = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i, v: `row-${i}` })));
  return { name, description: "big", async do() { return { status: "success", data: payload }; } };
}
function smallTool(name: string): GloveFoldArgs<Record<string, never>> {
  return { name, description: "small", async do() { return { status: "success", data: "ok" }; } };
}
function fakeGlove() {
  const folded: GloveFoldArgs<unknown>[] = [];
  const glove = { fold(t: GloveFoldArgs<unknown>) { folded.push(t); return glove; } } as unknown as IGloveRunnable;
  return { glove, folded };
}

test("containTools wraps every tool by default", async () => {
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const wrapped = containTools([bigTool("a"), bigTool("b")], { scratchpad: sp });
  for (const t of wrapped) {
    const r = await t.do({}, undefined as never, undefined as never);
    assert.equal((r.data as { scratchpad?: boolean }).scratchpad, true);
  }
  await sp.close();
});

test("shouldContain opts specific tools out (left exactly as-is)", async () => {
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const big = bigTool("big");
  const small = smallTool("small");
  const wrapped = containTools([big, small], {
    scratchpad: sp,
    shouldContain: (t) => t.name === "big",
  });
  assert.notEqual(wrapped[0], big); // big was wrapped
  assert.equal(wrapped[1], small); // small returned untouched (same reference)
  await sp.close();
});

test("onContain fires per containment with byte savings", async () => {
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const seen: { tool: string; bytesContained: number; bytesEmitted: number }[] = [];
  const wrapped = containTools([bigTool("search")], {
    scratchpad: sp,
    onContain: (info) => seen.push(info),
  });
  await wrapped[0].do({}, undefined as never, undefined as never);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tool, "search");
  assert.ok(seen[0].bytesContained > seen[0].bytesEmitted, "should keep more out than it emits");
  await sp.close();
});

test("createContainmentReporter aggregates across calls", async () => {
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const reporter = createContainmentReporter();
  const wrapped = containTools([bigTool("x"), bigTool("y")], {
    scratchpad: sp,
    onContain: reporter.onContain,
  });
  await wrapped[0].do({}, undefined as never, undefined as never);
  await wrapped[0].do({}, undefined as never, undefined as never);
  await wrapped[1].do({}, undefined as never, undefined as never);

  const report = reporter.report();
  assert.equal(report.calls, 3);
  assert.equal(report.byTool.x.calls, 2);
  assert.equal(report.byTool.y.calls, 1);
  assert.ok(report.reductionFactor > 1);
  assert.match(reporter.format(), /3 call\(s\).*contained.*emitted/);

  reporter.reset();
  assert.equal(reporter.report().calls, 0);
  await sp.close();
});

test("mountContainedTools folds the wrapped tools and returns their names", async () => {
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const { glove, folded } = fakeGlove();
  const names = mountContainedTools(glove, [bigTool("alpha"), bigTool("beta")], { scratchpad: sp });
  assert.deepEqual(names, ["alpha", "beta"]);
  assert.equal(folded.length, 2);
  await sp.close();
});

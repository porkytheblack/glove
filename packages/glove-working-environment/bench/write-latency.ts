/**
 * Per-write cost as the number of ever-mutated paths grows.
 *
 * `pnpm --filter glove-working-environment bench`
 *
 * The shape being measured, not the absolute number: writing file N should
 * cost roughly what writing file 1 cost. It did not — every mutation
 * serialized and rewrote the *entire* version index, so latency climbed with
 * the number of paths the environment had ever touched. A script that writes
 * a few hundred files paid escalating cost for no reason it could see.
 *
 * Reported as first-100 vs last-100 mean, because that ratio is the claim.
 * An absolute millisecond figure on one machine proves nothing.
 */
import { createWorkingEnvironment, hostDirectory } from "../src/index";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FILES = 1000;
const BODY = "x".repeat(256);

function summarise(label: string, ms: number[]): number {
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const first = mean(ms.slice(0, 100));
  const last = mean(ms.slice(-100));
  const ratio = last / first;
  console.log(
    `${label.padEnd(34)} first 100: ${first.toFixed(3)}ms   last 100: ${last.toFixed(3)}ms   ` +
      `ratio: ${ratio.toFixed(2)}×   total: ${(ms.reduce((a, b) => a + b, 0) / 1000).toFixed(2)}s`,
  );
  return ratio;
}

async function inMemory(): Promise<number> {
  const env = await createWorkingEnvironment({});
  try {
    const ms: number[] = [];
    for (let i = 0; i < FILES; i++) {
      const t0 = performance.now();
      await env.fs.writeFile(`/tmp/f${i}.txt`, BODY);
      ms.push(performance.now() - t0);
    }
    return summarise("in-memory, 1000 fresh paths", ms);
  } finally {
    await env.close({ graceMs: 100 });
  }
}

/** The other half: a host-backed tree used to re-walk its base on every write. */
async function hostBacked(): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "glove-bench-"));
  try {
    // A corpus worth walking, so a per-write walk is visible.
    await mkdir(join(dir, "inbox"), { recursive: true });
    for (let i = 0; i < 500; i++) await writeFile(join(dir, "inbox", `doc${i}.txt`), BODY);

    const env = await createWorkingEnvironment({ filesystem: hostDirectory(dir) });
    try {
      const ms: number[] = [];
      for (let i = 0; i < FILES; i++) {
        const t0 = performance.now();
        await env.fs.writeFile(`/out/f${i}.txt`, BODY);
        ms.push(performance.now() - t0);
      }
      return summarise("host directory, 500-file base", ms);
    } finally {
      await env.close({ graceMs: 100 });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const memRatio = await inMemory();
const hostRatio = await hostBacked();
console.log("");

// The host-backed case is fixed: `totalSize` is adjusted by the known delta
// instead of re-walking, so per-write cost is flat AND small (measured
// 137ms → 4.0ms per write against a 500-file base).
console.log(
  hostRatio < 3
    ? `host directory: flat at ${hostRatio.toFixed(2)}× — the per-write base walk is gone`
    : `host directory: STILL WALKING, ratio ${hostRatio.toFixed(2)}×`,
);

// The in-memory case is NOT fixed, and this benchmark exists to keep saying
// so. Every mutation rewrites the whole version index, so per-write cost
// grows with the number of paths the environment has ever touched.
//
// The obvious fix — coalescing the write — was tried and reverted: the index
// is part of the tree, so its bytes count against `maxVfsBytes`, and
// deferring the write makes a mutation that should be refused succeed. Two
// existing tests catch it. The real fix is the other one the issue names:
// an append-per-mutation log with periodic compaction, which keeps both the
// O(1) write and the immediate accounting. See #124.
console.log(
  memRatio < 3
    ? `in-memory: flat at ${memRatio.toFixed(2)}×`
    : `in-memory: version index still rewritten per mutation — ${memRatio.toFixed(2)}× growth over 1000 paths (#124, open)`,
);

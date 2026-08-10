/**
 * The worker pool's failure contract.
 *
 * Everything here is about what happens when a worker does NOT behave: it
 * never becomes ready, it dies before it starts, or the environment is closed
 * while a run is still queued behind another. All three used to end the same
 * way — a slot marked busy that nothing would ever free, or a thread nothing
 * would ever terminate — and all three are invisible, because writes and
 * write-time validation keep working through the overflow path while
 * `run_script` waits on nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LIMITS, createWorkingEnvironment } from "../src/index";
import { WorkerPool, type PoolDeps, type PoolOptions, type Slot } from "../src/executor/pool";

const TRIVIAL = "/scripts/trivial.js";
const deps: PoolDeps = {
  readSource: async (p) => (p === TRIVIAL ? "export default async function trivial() { return 42; }" : null),
  envModules: () => new Map(),
  pureModules: () => [],
  limits: { ...DEFAULT_LIMITS, runTimeoutMs: 5_000 },
};

/** A pool whose first `n` workers are born broken, in a chosen way. */
class BrokenPool extends WorkerPool {
  spawns = 0;
  constructor(
    options: PoolOptions,
    private readonly broken: number,
    private readonly how: "rejects" | "never-ready",
  ) {
    super(deps, options);
  }
  protected spawn(): Slot {
    const slot = super.spawn();
    this.spawns += 1;
    if (this.spawns <= this.broken) {
      void slot.worker.terminate().catch(() => undefined);
      slot.ready =
        this.how === "rejects"
          ? Promise.reject(new Error("simulated spawn failure (EAGAIN)"))
          : new Promise<void>(() => undefined); // never settles
      slot.ready.catch(() => undefined);
    }
    return slot;
  }
  /** Slots the pool still counts against its capacity. */
  get liveSlots(): number {
    return (this as unknown as { slots: Slot[] }).slots.length;
  }
}

const run = (pool: WorkerPool) => pool.execute({ mode: "run", path: TRIVIAL, readOnly: false });

test("a worker whose spawn fails does not permanently shrink the pool", async () => {
  // The slot was pushed before `await ready`, so it counted against capacity
  // from that moment. Left behind — busy, never ready — the pool at its
  // default size of 1 has no room to try again, and every later run waits
  // forever with no deadline running.
  const pool = new BrokenPool({ size: 1, readyTimeoutMs: 2_000 }, 1, "rejects");
  try {
    const first = await run(pool);
    assert.equal(first.ok, true, first.error ?? "");
    assert.equal(first.result, 42);
    assert.equal(pool.spawns, 2, "expected the pool to replace the failed worker, not reuse it");
    assert.equal(pool.liveSlots, 1, "the failed slot is still counted against capacity");

    const second = await run(pool);
    assert.equal(second.ok, true, second.error ?? "");
  } finally {
    await pool.close({ graceMs: 100 });
  }
});

test("a worker that never signals ready fails with a named error instead of hanging", async () => {
  const pool = new BrokenPool({ size: 1, readyTimeoutMs: 60 }, Number.MAX_SAFE_INTEGER, "never-ready");
  try {
    const started = Date.now();
    const result = await run(pool);
    assert.equal(result.ok, false, "a pool that can never produce a worker reported success");
    assert.match(result.error ?? "", /could not start a script worker/);
    assert.match(result.error ?? "", /did not become ready within 60ms/);
    // The point is that it *returns*. The run deadline cannot help here — it
    // is only armed once a worker has been acquired.
    assert.ok(Date.now() - started < 30_000, "took longer than the backoff curve should allow");
  } finally {
    await pool.close({ graceMs: 100 });
  }
});

test("a run queued at close() is refused, not executed on a worker nothing will terminate", async () => {
  // `close()` wakes the queued waiters. A woken waiter re-entered the acquire
  // loop, found free capacity, and spawned a worker AFTER close — running the
  // queued script successfully on a thread that then idled with its heap
  // until the process exited.
  const env = await createWorkingEnvironment({ execution: { size: 1 } });
  await env.fs.writeFile(
    "/scripts/slow.js",
    `export default async function slow(args) {
       const fs = await import('env:fs');
       const until = Date.now() + args.ms;
       while (Date.now() < until) await null;
       await fs.writeFile('/out/ran-' + args.tag + '.txt', 'executed');
       return { tag: args.tag };
     }`,
  );

  const first = env.runScript("/scripts/slow.js", { tag: "first", ms: 300 });
  const queued = env.runScript("/scripts/slow.js", { tag: "queued", ms: 10 });
  // Let the first take the only worker and the second reach the wait queue.
  await new Promise((r) => setTimeout(r, 120));

  await env.close({ graceMs: 2_000 });

  const [a, b] = await Promise.all([first, queued]);
  assert.equal(a.ok, true, `the in-flight run should be given its grace: ${a.error ?? ""}`);
  assert.equal(b.ok, false, "the queued run executed after close()");
  assert.match(b.error ?? "", /closed/);
  assert.equal(await env.fs.exists("/out/ran-first.txt"), true, "the in-flight run lost its output");
  assert.equal(await env.fs.exists("/out/ran-queued.txt"), false, "the queued run ran anyway");
});

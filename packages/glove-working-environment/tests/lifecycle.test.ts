/**
 * What an environment costs when nobody is using it, and what it costs to
 * start one.
 *
 * The failure these pin is not a crash — it is a bill. Steady residency for an
 * idle environment was measured at 16.5 MB and one OS thread, returned only on
 * `close()`; five open environments at +82.5 MB and +5 threads. A host holding
 * hundreds of sessions accumulates all of it with nothing built in to reap it
 * ([#122](https://github.com/porkytheblack/glove/issues/122)). The other half
 * is the create path: the validation-time adapter instances, the unconditional
 * `/std` + `/skills` rewrite, and a cold pool that makes the first script pay
 * for thread start-up ([#129](https://github.com/porkytheblack/glove/issues/129)).
 *
 * Everything here is timing-shaped, so nothing here *waits and hopes*: the
 * idle tests use a short `idleTimeoutMs` and assert on the pool's own slot
 * list, and the prewarm test polls for an observable fact until a deadline
 * rather than sleeping for a guess.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LIMITS,
  createWorkingEnvironment,
  defineAdapter,
  fromSnapshot,
  type EnvSnapshot,
  type StdlibAdapter,
  type Vfs,
  type VfsEntry,
  type VfsStat,
} from "../src/index";
import { WorkerPool, type PoolDeps, type PoolOptions, type Slot } from "../src/executor/pool";

const TRIVIAL = "/scripts/trivial.js";
const deps: PoolDeps = {
  readSource: async (p) => (p === TRIVIAL ? "export default async function trivial() { return 42; }" : null),
  envModules: () => new Map(),
  pureModules: () => [],
  limits: { ...DEFAULT_LIMITS, runTimeoutMs: 5_000 },
};

/** A pool that reports what it has, and can be told to spawn badly. */
class ProbePool extends WorkerPool {
  spawns = 0;
  constructor(
    options: PoolOptions,
    private readonly brokenSpawns = 0,
  ) {
    super(deps, options);
  }
  protected spawn(): Slot {
    const slot = super.spawn();
    this.spawns += 1;
    if (this.spawns <= this.brokenSpawns) {
      void slot.worker.terminate().catch(() => undefined);
      slot.ready = Promise.reject(new Error("simulated spawn failure (EAGAIN)"));
      slot.ready.catch(() => undefined);
    }
    return slot;
  }
  get liveSlots(): number {
    return (this as unknown as { slots: Slot[] }).slots.length;
  }
  /** The pool's own pending idle sweep. Named apart from the private field it
   *  reads, because a public member of the same name is not assignable to it. */
  get sweep(): { hasRef?(): boolean } | null {
    return (this as unknown as { reapTimer: { hasRef?(): boolean } | null }).reapTimer;
  }
}

const run = (pool: WorkerPool) => pool.execute({ mode: "run", path: TRIVIAL, readOnly: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until `check` holds, so a timing test fails on a deadline, not a guess. */
async function until(check: () => boolean, ms = 10_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await sleep(10);
  return check();
}

// ==================================================== idle worker reaping

test("an idle worker is reaped and the next run spawns a fresh one", async () => {
  const pool = new ProbePool({ size: 1, idleTimeoutMs: 60 });
  try {
    assert.equal((await run(pool)).ok, true);
    assert.equal(pool.liveSlots, 1);

    assert.ok(await until(() => pool.liveSlots === 0, 2_000), "the idle worker was never reaped");

    const again = await run(pool);
    assert.equal(again.ok, true, again.error ?? "");
    assert.equal(again.result, 42, "a reaped pool did not come back on demand");
    assert.equal(pool.spawns, 2, "expected exactly one replacement worker");
  } finally {
    await pool.close({ graceMs: 100 });
  }
});

test("idleTimeoutMs: 0 keeps the worker warm forever", async () => {
  const pool = new ProbePool({ size: 1, idleTimeoutMs: 0 });
  try {
    assert.equal((await run(pool)).ok, true);
    assert.equal(pool.sweep, null, "a sweep was armed for a pool that opted out of reaping");
    await sleep(150);
    assert.equal(pool.liveSlots, 1, "the warm worker was reaped despite idleTimeoutMs: 0");
    assert.equal(pool.spawns, 1);
  } finally {
    await pool.close({ graceMs: 100 });
  }
});

test("the idle sweep never holds the process open", async () => {
  // An interval that keeps the event loop alive would hang every test run and
  // every host embedding this — the same reason `spawn()` unrefs the worker.
  const pool = new ProbePool({ size: 1, idleTimeoutMs: 60_000 });
  try {
    assert.equal((await run(pool)).ok, true);
    const timer = pool.sweep;
    assert.ok(timer, "no sweep was armed for the freed worker");
    assert.equal(timer.hasRef?.(), false, "the idle sweep timer is not unref'd");
  } finally {
    await pool.close({ graceMs: 100 });
  }
});

test("close() clears the idle sweep", async () => {
  const pool = new ProbePool({ size: 1, idleTimeoutMs: 60_000 });
  assert.equal((await run(pool)).ok, true);
  assert.notEqual(pool.sweep, null);
  await pool.close({ graceMs: 100 });
  // Left armed, the sweep outlives the pool it was armed for and goes on
  // discarding slots `close()` has already taken.
  assert.equal(pool.sweep, null, "close() left a sweep armed");
});

test("a worker running a script is never reaped out from under it", async () => {
  // The sweep has to already be armed for the slot the slow run then takes —
  // otherwise nothing fires while it is busy and the test proves nothing.
  const env = await createWorkingEnvironment({ execution: { size: 1, idleTimeoutMs: 40 } });
  try {
    await env.fs.writeFile("/scripts/quick.js", `export default async function quick() { return 'ok'; }`);
    await env.fs.writeFile(
      "/scripts/slow.js",
      `export default async function slow() {
         const until = Date.now() + 400;
         while (Date.now() < until) await null;
         return 'done';
       }`,
    );
    assert.equal((await env.runScript("/scripts/quick.js")).ok, true);

    const result = await env.runScript("/scripts/slow.js");
    assert.equal(result.ok, true, `the reaper terminated a busy worker: ${result.error ?? ""}`);
    assert.equal(result.result, "done");
  } finally {
    await env.close({ graceMs: 100 });
  }
});

// ======================================================= prewarm / warmup

test("warmup spawns the pool up front and the first run reuses it", async () => {
  const pool = new ProbePool({ size: 2, idleTimeoutMs: 0 });
  try {
    await pool.warmup();
    assert.equal(pool.spawns, 2, "warmup did not fill the pool");
    assert.equal(pool.liveSlots, 2);

    const first = await run(pool);
    assert.equal(first.ok, true, first.error ?? "");
    assert.equal(pool.spawns, 2, "the first run spawned a worker instead of taking a warm one");
  } finally {
    await pool.close({ graceMs: 100 });
  }
});

test("a failed prewarm leaves the pool exactly as it was, to be retried on demand", async () => {
  const pool = new ProbePool({ size: 1, idleTimeoutMs: 0, readyTimeoutMs: 2_000 }, 1);
  try {
    await pool.warmup(); // must not reject, and must not leave the slot behind
    assert.equal(pool.liveSlots, 0, "the failed prewarm slot still counts against capacity");

    const result = await run(pool);
    assert.equal(result.ok, true, result.error ?? "");
    assert.equal(result.result, 42);
  } finally {
    await pool.close({ graceMs: 100 });
  }
});

test("execution.prewarm starts a worker in the background, with no script involved", async () => {
  const seen: boolean[] = [];
  const spy = defineAdapter({
    name: "spy",
    description: "records which instance was built",
    types: "export function ping(): Promise<string>;",
    create: (_vfs, ctx) => {
      seen.push(ctx.readOnly);
      return { ping: async () => "pong" };
    },
  });
  const env = await createWorkingEnvironment({ stdlib: [spy], execution: { prewarm: true } });
  try {
    // The pool describes BOTH namespaces into the worker when it starts one,
    // so the read-only twin being built is proof a worker started — with
    // nothing written and nothing run.
    assert.ok(await until(() => seen.includes(true)), "no worker was started in the background");
  } finally {
    await env.close({ graceMs: 100 });
  }
});

// ============================================== /std and /skills on restore

/** Counts the mutations a create performs, per path. */
class CountingFs implements Vfs {
  writes: string[] = [];
  removes: string[] = [];
  constructor(private readonly inner: Vfs) {}
  read(path: string): Promise<Uint8Array> {
    return this.inner.read(path);
  }
  write(path: string, data: Uint8Array): Promise<void> {
    this.writes.push(path);
    return this.inner.write(path, data);
  }
  rm(path: string): Promise<void> {
    this.removes.push(path);
    return this.inner.rm(path);
  }
  mkdir(path: string): Promise<void> {
    return this.inner.mkdir(path);
  }
  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }
  stat(path: string): Promise<VfsStat | null> {
    return this.inner.stat(path);
  }
  list(path: string): Promise<VfsEntry[]> {
    return this.inner.list(path);
  }
  files(): Promise<string[]> {
    return this.inner.files();
  }
  totalSize(): Promise<number> {
    return this.inner.totalSize();
  }
}

const textkit = (types = "export function shout(input: string, output: string): Promise<string>;") =>
  defineAdapter({
    name: "textkit",
    description: "Toy adapter.",
    types,
    docs: "# textkit\n",
    create: (vfs) => ({
      async shout(input: string, output: string) {
        await vfs.writeFile(output, (await vfs.readFile(input)).toUpperCase());
        return output;
      },
    }),
  });

async function snapshotOf(stdlib: StdlibAdapter[]): Promise<EnvSnapshot> {
  const env = await createWorkingEnvironment({ stdlib });
  try {
    return await env.snapshot();
  } finally {
    await env.close({ graceMs: 100 });
  }
}

/** Restore onto a counting filesystem and report what create touched. */
async function restore(snap: EnvSnapshot, stdlib: StdlibAdapter[]): Promise<CountingFs> {
  const fs = new CountingFs(fromSnapshot(snap));
  const env = await createWorkingEnvironment({ filesystem: fs, stdlib });
  await env.close({ graceMs: 100 });
  return fs;
}

const generated = (paths: string[]) => paths.filter((p) => p.startsWith("/std") || p.startsWith("/skills"));

test("restoring an identical snapshot rewrites nothing under /std or /skills", async () => {
  const snap = await snapshotOf([textkit()]);
  const fs = await restore(snap, [textkit()]);

  // Previously: an unconditional `rm -r` of both directories followed by a
  // byte-for-byte rebuild. On `hostDirectory` those are real writes; on
  // `cachedRemote` they are network round trips — to change nothing.
  assert.deepEqual(generated(fs.writes), [], "an identical restore rewrote generated docs");
  assert.deepEqual(generated(fs.removes), [], "an identical restore wiped generated directories");
});

test("an adapter dropped between sessions has its /std docs swept", async () => {
  const snap = await snapshotOf([textkit()]);
  const fs = await restore(snap, []);

  // The stale case is exactly why the wipe existed: docs describing a module
  // that is no longer registered read as a capability the model can use.
  assert.equal(await fs.exists("/std/textkit/index.d.ts"), false, "stale adapter docs survived the restore");
  assert.equal(await fs.exists("/std/README.md"), true);
  assert.ok(fs.removes.includes("/std"), "the stale sweep did not run");
});

test("only the docs that actually changed are rewritten", async () => {
  const snap = await snapshotOf([textkit()]);
  const fs = await restore(snap, [textkit("export function shout(input: string): Promise<string>;")]);

  // /std/README.md carries the module table, which this adapter's types do not
  // appear in — so the changed .d.ts should be the only file rewritten, and
  // nothing should have been removed to do it.
  assert.deepEqual(generated(fs.writes), ["/std/textkit/index.d.ts"]);
  assert.deepEqual(generated(fs.removes), []);
});

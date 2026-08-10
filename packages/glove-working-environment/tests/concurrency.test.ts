/**
 * The environment under concurrent access.
 *
 * The agent loop is serial, so none of this shows up in a single-agent
 * session. It shows up the moment a *host* is involved: a server taking a
 * snapshot on a persistence tick, a Save button calling `export()`, a second
 * request touching the same environment — all while a script is running or
 * the model is writing one. Each test below is a probe from the concurrency
 * audit, kept as a regression test because every one of them failed silently
 * or crashed the durability path.
 *
 * ## Two things make these tests real rather than lucky
 *
 * **They run against a slow filesystem.** On the default `InMemoryFs` a
 * snapshot is one *synchronous* walk (`toSnapshot()`), and synchronous code
 * cannot interleave — so the bug is invisible there and a test written
 * against it proves nothing. Every VFS a production host actually uses
 * (`hostDirectory`, `cachedRemote`) does real I/O, which means a real await
 * point between listing a file and reading it. {@link gatedFs} models that:
 * the same in-memory storage, one event loop turn per operation.
 *
 * **They park the walk at a chosen file.** Racing a writer against a reader
 * and hoping to catch a tear gives a test that passes for the wrong reason
 * roughly half the time — in *both* directions, which is worse than no test.
 * Instead the filesystem blocks the observer mid-walk, the mutation is
 * issued, and only then is the observer released. Under the mutation queue
 * the mutation cannot start; without it, it commits underneath the walk. The
 * outcome is the same on every run.
 *
 * ## The transaction being observed
 *
 * Writing a script is a genuine multi-file commit: the `.js` and its derived
 * `.d.ts` land under one hold of the lock. {@link generation} stamps a number
 * into both, so "these two files came from different moments" is a one-line
 * assertion rather than a judgement call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { call, callOk } from "./helpers";
import { createWorkingEnvironment, type EnvLimits, type Vfs, type WorkingEnvironment } from "../src/index";
import { inMemoryFs } from "../src/vfs/memory";

const tick = () => new Promise<void>((r) => setImmediate(r));
/** Long enough for an unserialized mutation to run start to finish. */
const settle = () => new Promise<void>((r) => setTimeout(r, 50));

interface Gate {
  fs: Vfs;
  /** Park the next matching operation, once. */
  arm(match: (path: string) => boolean, on?: "read" | "list"): Promise<void>;
  /** Let the parked operation continue. */
  release(): void;
}

/**
 * In-memory storage behind a filesystem that yields to the event loop on
 * every call — a stand-in for any backend doing real I/O — and that can park
 * one chosen operation until the test releases it.
 *
 * Being a plain object it is also not an `InMemoryFs`, so `snapshot()` takes
 * the async walk a host-backed tree takes.
 */
function gatedFs(storage: Vfs = inMemoryFs()): Gate {
  let matcher: ((path: string) => boolean) | null = null;
  let kind: "read" | "list" = "read";
  let announceArrival: (() => void) | null = null;
  let resume: (() => void) | null = null;

  // The gate fires AFTER the operation it catches, so the parked walk is
  // holding one half of the pair when the mutation is issued. Firing before
  // would let both halves be read after the release, from the same (new)
  // state, and the test would pass without proving anything.
  const gateAfter = async (path: string, on: "read" | "list") => {
    if (!matcher || kind !== on || !matcher(path)) return;
    matcher = null;
    announceArrival?.();
    await new Promise<void>((r) => {
      resume = r;
    });
  };

  const fs: Vfs = {
    read: async (p) => {
      await tick();
      const data = await storage.read(p);
      await gateAfter(p, "read");
      return data;
    },
    list: async (p) => {
      await tick();
      const entries = await storage.list(p);
      await gateAfter(p, "list");
      return entries;
    },
    write: async (p, d) => (await tick(), storage.write(p, d)),
    rm: async (p) => (await tick(), storage.rm(p)),
    mkdir: async (p) => (await tick(), storage.mkdir(p)),
    exists: async (p) => (await tick(), storage.exists(p)),
    stat: async (p) => (await tick(), storage.stat(p)),
    files: async () => (await tick(), storage.files()),
    totalSize: async () => (await tick(), storage.totalSize()),
  };

  return {
    fs,
    arm(match, on = "read") {
      matcher = match;
      kind = on;
      return new Promise<void>((r) => {
        announceArrival = r;
      });
    },
    release() {
      resume?.();
      resume = null;
    },
  };
}

async function withGate(
  fn: (env: WorkingEnvironment, gate: Gate) => Promise<void>,
  opts?: { limits?: Partial<EnvLimits> },
): Promise<void> {
  const gate = gatedFs();
  const env = await createWorkingEnvironment({ filesystem: gate.fs, limits: opts?.limits });
  try {
    await fn(env, gate);
  } finally {
    gate.release(); // never leave a parked operation holding the lock at teardown
    await env.close({ graceMs: 200 });
  }
}

const GEN_JS = "/scripts/gen.js";
const GEN_DTS = "/scripts/gen.d.ts";
const isGenPair = (p: string) => p === GEN_JS || p === GEN_DTS;

/** A script whose generation number appears in both the `.js` and its `.d.ts`. */
const generation = (n: number) =>
  `/** Generation ${n}. @param {{}} args @returns {Promise<number>} */\n` +
  `export default async function gen${n}(args) { return ${n}; }\n`;

const generationOf = (text: string): string | null => text.match(/Generation (\d+)\./)?.[1] ?? null;
const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf8");
const bytesOf = (s: { files: Array<{ data: string }> }) =>
  s.files.reduce((n, f) => n + Buffer.from(f.data, "base64").byteLength, 0);

interface Snap {
  files: Array<{ path: string; data: string }>;
}
const fileIn = (s: Snap, p: string) => s.files.find((f) => f.path === p);

/**
 * Park `observer` mid-walk at the script pair, commit a new generation
 * underneath it, then let it finish. Returns what it saw.
 */
async function observeAcrossAWrite<T>(env: WorkingEnvironment, gate: Gate, observer: () => Promise<T>): Promise<T> {
  await env.fs.writeFile(GEN_JS, generation(1));
  const parked = gate.arm(isGenPair);
  const observing = observer();
  await parked;

  // Issued, deliberately not awaited: under the mutation queue it cannot
  // even start while the observer holds the lock, which is the point.
  const writing = env.fs.writeFile(GEN_JS, generation(2));
  await settle();
  gate.release();

  const seen = await observing;
  await writing;
  return seen;
}

test("snapshot() cannot capture half of a write", async () => {
  await withGate(async (env, gate) => {
    const snap = (await observeAcrossAWrite(env, gate, () => env.snapshot())) as Snap;
    const js = fileIn(snap, GEN_JS);
    const dts = fileIn(snap, GEN_DTS);
    assert.ok(js && dts, "snapshot dropped one half of the pair");
    assert.equal(
      generationOf(decode(js.data)),
      generationOf(decode(dts.data)),
      "snapshot captured a script and a .d.ts from different generations — a tree the environment was never in",
    );
  });
});

test("snapshot() does not reject when the version ring rotates a blob out mid-walk", async () => {
  // The crash the audit hit: the walk lists the blob directory, and by the
  // time it reads one of those blobs a mutation has rotated it out of the
  // ring. `maxVersionsPerFile: 1` makes every write drop a blob.
  await withGate(
    async (env, gate) => {
      await env.fs.writeFile("/tmp/notes.txt", "one");
      await env.fs.writeFile("/tmp/notes.txt", "two");

      const parked = gate.arm((p) => p === "/.env/versions/blobs", "list");
      const snapping = env.snapshot();
      await parked;

      const writing = env.fs.writeFile("/tmp/notes.txt", "three");
      await settle();
      gate.release();

      // Without the queue this rejects with `no such file:
      // /.env/versions/blobs/v…` — the durability path failing outright.
      const snap = (await snapping) as Snap;
      await writing;
      assert.ok(fileIn(snap, "/tmp/notes.txt"), "snapshot came back without the file");
    },
    { limits: { maxVersionsPerFile: 1 } },
  );
});

test("export() returns a set of files from one moment", async () => {
  await withGate(async (env, gate) => {
    const files = await observeAcrossAWrite(env, gate, () => env.export("/scripts/**"));
    const text = (p: string) => {
      const f = files.find((x) => x.path === p);
      return f ? Buffer.from(f.bytes).toString("utf8") : null;
    };
    const [js, dts] = [text(GEN_JS), text(GEN_DTS)];
    assert.ok(js && dts, "export dropped one half of a file pair it had just listed");
    assert.equal(generationOf(js), generationOf(dts), "export split a transaction across two generations");
  });
});

test("checkpoint fork captures a tree from one moment", async () => {
  await withGate(async (env, gate) => {
    const message = await observeAcrossAWrite(env, gate, () => callOk(env, "checkpoint", { action: "fork", name: "mid" }));
    assert.match(message, /saved checkpoint "mid"/);

    const stored = JSON.parse(await env.fs.readFile("/.env/branches/mid.json")) as { snapshot: Snap };
    const js = fileIn(stored.snapshot, GEN_JS);
    const dts = fileIn(stored.snapshot, GEN_DTS);
    assert.ok(js && dts, "checkpoint caught only half of a script and its types");
    assert.equal(
      generationOf(decode(js.data)),
      generationOf(decode(dts.data)),
      "fork saved a checkpoint of a tree that never existed",
    );
  });
});

test("checkpoint restore is exact", async () => {
  await withGate(async (env) => {
    await env.fs.writeFile(GEN_JS, generation(1));
    await callOk(env, "checkpoint", { action: "fork", name: "base" });
    await env.fs.writeFile(GEN_JS, generation(2));
    await env.fs.writeFile("/tmp/after-fork.txt", "created later");

    assert.match(await callOk(env, "checkpoint", { action: "restore", name: "base" }), /restored "base"/);
    assert.equal(await env.fs.readFile(GEN_JS), generation(1), "restore did not put the checkpoint's content back");
    assert.match(await env.fs.readFile(GEN_DTS), /Generation 1\./, "restore left a .d.ts from the wrong generation");
    assert.equal(await env.fs.exists("/tmp/after-fork.txt"), false, "restore left a file created after the fork");
  });
});

test("two concurrent mounts cannot both pass the size check and together exceed the cap", async () => {
  // The headroom fits one blob, not two. Unlocked, both mounts read the same
  // `total`, both pass, and the tree ends up over its own cap with the host
  // told twice that everything was fine.
  const CAP = 4_000_000;
  await withGate(
    async (env) => {
      const used = bytesOf((await env.snapshot()) as Snap);
      const headroom = CAP - used;
      assert.ok(headroom > 200_000, `not enough headroom to test with: ${headroom}`);
      const blob = new Uint8Array(Math.floor(headroom * 0.7)).fill(65); // one fits, two do not

      const results = await Promise.allSettled([env.mount(blob, "/inbox/one.bin"), env.mount(blob, "/inbox/two.bin")]);
      const admitted = results.filter((r) => r.status === "fulfilled").length;
      assert.equal(admitted, 1, `expected exactly one mount to be admitted, got ${admitted}`);

      const total = bytesOf((await env.snapshot()) as Snap);
      assert.ok(total <= CAP, `tree grew past maxVfsBytes: ${total} > ${CAP}`);
    },
    { limits: { maxVfsBytes: CAP, maxFileBytes: CAP } },
  );
});

test("checkpoint restore clears the undo history of files it rewrote", async () => {
  await withGate(async (env) => {
    await env.fs.writeFile("/tmp/notes.txt", "v1");
    await callOk(env, "checkpoint", { action: "fork", name: "at-v1" });
    await env.fs.writeFile("/tmp/notes.txt", "v2");
    assert.equal(await env.fs.readFile("/tmp/notes.txt"), "v2");

    const msg = await callOk(env, "checkpoint", { action: "restore", name: "at-v1" });
    assert.match(msg, /undo history was cleared/);
    assert.equal(await env.fs.readFile("/tmp/notes.txt"), "v1");

    // Without forgetting, this `undo` walks back to the pre-restore ring and
    // quietly reinstates "v2" — content the restore existed to remove.
    const undone = await call(env, "undo", { path: "/tmp/notes.txt" });
    assert.equal(undone.status, "error", `undo after restore should have nothing to revert, got: ${String(undone.data)}`);
    assert.equal(await env.fs.readFile("/tmp/notes.txt"), "v1");
  });
});

test("a restore that fails part-way rolls the tree back", async () => {
  // Arm a write failure only once the restore is under way, so the tree is
  // genuinely mid-apply — some files removed, some rewritten — when it hits.
  let armed = false;
  let seen = 0;
  const storage = inMemoryFs();
  const flaky: Vfs = {
    ...gatedFs(storage).fs,
    write: async (p, d) => {
      if (armed && p.startsWith("/tmp/") && ++seen === 2) throw new Error(`simulated device failure writing ${p}`);
      await tick();
      return storage.write(p, d);
    },
  };
  const env = await createWorkingEnvironment({ filesystem: flaky });
  try {
    await env.fs.writeFile("/tmp/a.txt", "original a");
    await env.fs.writeFile("/tmp/b.txt", "original b");
    await env.fs.writeFile("/tmp/c.txt", "original c");
    await callOk(env, "checkpoint", { action: "fork", name: "good" });

    await env.fs.writeFile("/tmp/a.txt", "edited a");
    await env.fs.writeFile("/tmp/d.txt", "made after the fork");

    armed = true;
    const failed = await call(env, "checkpoint", { action: "restore", name: "good" });
    armed = false;
    assert.equal(failed.status, "error", "the simulated failure did not surface");
    assert.match(failed.message ?? "", /simulated device failure/);

    // The tree is back to what it was before the restore was attempted — not
    // a mixture of the two, which is the state checkpoints exist to prevent
    // and the state a bare restore used to leave behind.
    assert.equal(await env.fs.readFile("/tmp/a.txt"), "edited a");
    assert.equal(await env.fs.readFile("/tmp/b.txt"), "original b");
    assert.equal(await env.fs.readFile("/tmp/c.txt"), "original c");
    assert.equal(await env.fs.readFile("/tmp/d.txt"), "made after the fork");

    // And the checkpoint is still usable once the filesystem behaves.
    await callOk(env, "checkpoint", { action: "restore", name: "good" });
    assert.equal(await env.fs.readFile("/tmp/a.txt"), "original a");
    assert.equal(await env.fs.exists("/tmp/d.txt"), false);
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("a write from a run reported dead does not land afterwards", async () => {
  // Terminating the worker does not stop the host. A `core.write` the script
  // asked for is already over here, and it can be queued behind whatever
  // holds the mutation lock — so it commits seconds after `run_script` has
  // told the model the run was killed, silently diverging the tree and
  // potentially clobbering the retry's output.
  //
  // Staged exactly: the host takes the lock for longer than the run's whole
  // budget, the script's write queues behind it, and the deadline fires while
  // it waits.
  const storage = inMemoryFs();
  const slowPath = "/tmp/slow.bin";
  const fs: Vfs = {
    ...gatedFs(storage).fs,
    write: async (p, d) => {
      if (p === slowPath) await new Promise((r) => setTimeout(r, 1_500));
      await tick();
      return storage.write(p, d);
    },
  };
  const env = await createWorkingEnvironment({
    filesystem: fs,
    limits: { runTimeoutMs: 400 },
    execution: { graceMs: 100 },
  });
  try {
    await env.fs.writeFile(
      "/scripts/late.js",
      `export default async function late() {
         const fs = await import('env:fs');
         const until = Date.now() + 150;
         while (Date.now() < until) await null;
         await fs.writeFile('/out/zombie.txt', 'written by a run that was already dead');
         return { wrote: true };
       }`,
    );

    const running = env.runScript("/scripts/late.js", {});
    const holding = env.fs.writeFile(slowPath, "x".repeat(64));

    const run = await running;
    assert.equal(run.ok, false, "the run should have been killed on its deadline");
    assert.match(run.error ?? "", /wall-clock limit|deadline|terminated/);

    await holding;
    // Give the queued write every chance to commit.
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(
      await env.fs.exists("/out/zombie.txt"),
      false,
      "a write from a run already reported dead landed in the tree",
    );
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("validating a slow script write does not stall a concurrent run's fs calls", async () => {
  // Validation executes the module's top level with a budget of runTimeoutMs
  // — up to 30 seconds. Held inside the mutation queue, every other mutation
  // waits behind it, including the `env:fs` writes of scripts that are
  // running right now and whose own deadlines keep ticking. The run then dies
  // with a timeout that reads as its own fault.
  const env = await createWorkingEnvironment({ execution: { size: 2 } });
  try {
    await env.fs.writeFile(
      "/scripts/timed.js",
      `export default async function timed(args) {
         const fs = await import('env:fs');
         let slowest = 0;
         for (let i = 0; i < args.n; i++) {
           const t0 = Date.now();
           await fs.writeFile('/tmp/t' + i + '.txt', 'x');
           slowest = Math.max(slowest, Date.now() - t0);
           const until = Date.now() + 15;
           while (Date.now() < until) await null;
         }
         return { slowest };
       }`,
    );
    const running = env.runScript("/scripts/timed.js", { n: 40 });
    await new Promise((r) => setTimeout(r, 60)); // let it get going

    // A script whose top level takes ~1.2s to evaluate. Perfectly legal, and
    // exactly what an expensive import or a generated table costs.
    const STALL_MS = 1_200;
    const slowWrite = env.fs.writeFile(
      "/scripts/slow.js",
      `const until = Date.now() + ${STALL_MS};\n` +
        `while (Date.now() < until) {}\n` +
        `/** Slow to load. @param {{}} args @returns {Promise<number>} */\n` +
        `export default async function slow(args) { return 1; }\n`,
    );

    await slowWrite; // it must still be validated and committed
    const run = await running;
    assert.equal(run.ok, true, run.error ?? "");
    const { slowest } = run.result as { slowest: number };
    assert.ok(
      slowest < STALL_MS / 2,
      `a concurrent run's writeFile waited ${slowest}ms behind script validation (stall was ${STALL_MS}ms)`,
    );
    assert.match(await env.fs.readFile("/scripts/slow.d.ts"), /Slow to load/, "the slow script was not validated");
  } finally {
    await env.close({ graceMs: 500 });
  }
});

test("mount and export copy their buffers", async () => {
  // `InMemoryFs` stores and returns the buffer it is given. A host that
  // mounts a pooled read buffer, or writes into what it exported, would
  // otherwise be editing the tree in place — no verb recorded, no version
  // taken, and nothing for the model to notice.
  await withGate(async (env) => {
    const source = new TextEncoder().encode("as mounted");
    await env.mount(source, "/inbox/doc.txt");
    source.fill(88); // the host reuses its buffer
    assert.equal(await env.fs.readFile("/inbox/doc.txt"), "as mounted", "mount adopted the host's buffer");

    const [exported] = await env.export("/inbox/doc.txt");
    exported.bytes.fill(89); // the host writes into what it was given
    assert.equal(await env.fs.readFile("/inbox/doc.txt"), "as mounted", "export handed out the live buffer");
  });
});

test("after close(), env.fs refuses mutations but still reads", async () => {
  // Nothing will run, validate or persist a write made after close. Accepting
  // one leaves the host believing work landed that has nowhere to go.
  const env = await createWorkingEnvironment({});
  await env.fs.writeFile("/out/report.txt", "the deliverable");
  await env.close({ graceMs: 100 });

  await assert.rejects(() => env.fs.writeFile("/out/late.txt", "too late"), /has been closed/);
  await assert.rejects(() => env.fs.rm("/out/report.txt"), /has been closed/);

  // Draining a closed environment is the correct flow, so reads stay open.
  assert.equal(await env.fs.readFile("/out/report.txt"), "the deliverable");
  const exported = await env.export("/out/**");
  assert.equal(exported.length, 1);
  assert.ok(((await env.snapshot()) as Snap).files.some((f) => f.path === "/out/report.txt"));
});

test("waiting runs are served in the order they arrived", async () => {
  // A `release` that only says "one is free" leaves the freed worker up for
  // grabs, and a caller entering acquire in the same turn takes it ahead of
  // whoever has been waiting. Under sustained load that starves the queue.
  //
  // Unlike its neighbours this one does NOT fail against the unfixed pool:
  // the window is a single microtask wide and `runScript` does async work
  // before it reaches `acquire`, so it never lands inside it. Kept as a pin
  // on the invariant — handing the slot over is what makes the queue order
  // mean anything — not as a reproduction.
  const env = await createWorkingEnvironment({ execution: { size: 1 } });
  try {
    await env.fs.writeFile(
      "/scripts/mark.js",
      `export default async function mark(args) {
         const fs = await import('env:fs');
         await fs.appendFile('/tmp/order.txt', args.tag + '\\n');
         const until = Date.now() + args.ms;
         while (Date.now() < until) await null;
         return { tag: args.tag };
       }`,
    );
    // The first takes the only worker; the rest queue in arrival order, each
    // started a beat apart so "arrival order" is unambiguous.
    // Spacing is deliberately close to the run length, so new arrivals land
    // in the same turns as releases — the window where a barging caller can
    // take a slot ahead of someone already waiting for one.
    const tags = "abcdefghij".split("");
    const runs: Array<Promise<unknown>> = [];
    for (const tag of tags) {
      runs.push(env.runScript("/scripts/mark.js", { tag, ms: 6 }));
      await new Promise((r) => setTimeout(r, 6));
    }
    await Promise.all(runs);
    assert.equal((await env.fs.readFile("/tmp/order.txt")).trim().split("\n").join(""), tags.join(""));
  } finally {
    await env.close({ graceMs: 500 });
  }
});

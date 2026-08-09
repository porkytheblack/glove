/**
 * The session registry every host writes, and the three bugs it ships with.
 *
 * These are concurrency and lifetime tests, so the "session" here is a cheap
 * stand-in with a create latency — an environment would make the same
 * assertions slower without making them stronger. The one test that uses a
 * real environment is the one that has to: eviction has to actually shut a
 * worker pool down.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionManager, createWorkingEnvironment } from "../src/index";

interface Fake {
  id: string;
  closed: boolean;
}

/** A manager over fake sessions, plus the log of what it built and dropped. */
function fakes(options?: Partial<Parameters<typeof createSessionManager<Fake>>[0]> & { delayMs?: number }) {
  const created: string[] = [];
  const disposed: string[] = [];
  let clock = 0;
  const manager = createSessionManager<Fake>({
    async create(id) {
      created.push(id);
      if (options?.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
      return { id, closed: false };
    },
    dispose(session) {
      session.closed = true;
      disposed.push(session.id);
    },
    now: () => clock,
    ...options,
  });
  return { manager, created, disposed, tick: (ms: number) => (clock += ms) };
}

test("two requests arriving together share one session", async () => {
  // The bug in every hand-written registry: `if (!map.has(id)) map.set(id,
  // await create(id))`. Both callers pass the guard before either create
  // finishes, so one environment is orphaned — worker thread alive, close()
  // never called — and the two requests act on different trees.
  const { manager, created } = fakes({ delayMs: 20 });
  const [a, b, c] = await Promise.all([manager.get("s1"), manager.get("s1"), manager.get("s1")]);
  assert.equal(created.length, 1, `create ran ${created.length} times for one session id`);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(manager.size, 1);
});

test("a create that fails is not remembered", async () => {
  let attempt = 0;
  const manager = createSessionManager<Fake>({
    async create(id) {
      if (++attempt === 1) throw new Error("model client not ready");
      return { id, closed: false };
    },
    dispose() {},
  });
  await assert.rejects(() => manager.get("s1"), /model client not ready/);
  // A transient failure must not pin the id to that error for the life of the
  // process — the next request retries.
  assert.equal(manager.size, 0);
  assert.equal((await manager.get("s1")).id, "s1");
  assert.equal(attempt, 2);
});

test("idle sessions are evicted and active ones are not", async () => {
  const { manager, disposed, tick } = fakes({ idleMs: 1000 });
  await manager.get("stale");
  await manager.get("busy");

  tick(600);
  await manager.get("busy"); // touched
  tick(600);

  assert.equal(await manager.reap(), 1);
  assert.deepEqual(disposed, ["stale"]);
  assert.deepEqual(manager.ids(), ["busy"]);
});

test("a held session survives the sweep that would otherwise drop it", async () => {
  // A turn can spend four minutes inside one run_script. Evicting mid-turn
  // closes the worker pool under the running script and reports it to the
  // person as the environment being closed.
  const { manager, disposed, tick } = fakes({ idleMs: 1000 });
  await manager.get("long-turn");
  const release = manager.hold("long-turn");

  tick(5000);
  assert.equal(await manager.reap(), 0);
  assert.deepEqual(disposed, []);

  // Releasing marks the session used, because it just was — so it starts a
  // fresh idle window rather than being swept the instant the turn returns.
  release();
  assert.equal(await manager.reap(), 0);
  tick(5000);
  assert.equal(await manager.reap(), 1, "and it is collected once it has really gone quiet");
  assert.deepEqual(disposed, ["long-turn"]);
});

test("maxAgeMs drops a session that never goes idle", async () => {
  const { manager, disposed, tick } = fakes({ idleMs: 0, maxAgeMs: 1000 });
  await manager.get("forever");
  for (let i = 0; i < 5; i++) {
    tick(300);
    await manager.get("forever"); // touched constantly, never idle
  }
  await manager.reap();
  assert.deepEqual(disposed, ["forever"]);
});

test("over capacity, the least recently used go first", async () => {
  const { manager, disposed, tick } = fakes({ idleMs: 0, max: 2 });
  await manager.get("a");
  tick(10);
  await manager.get("b");
  tick(10);
  await manager.get("c");
  tick(10);
  await manager.get("a"); // a is now the freshest

  await manager.reap();
  assert.deepEqual(disposed, ["b"]);
  assert.deepEqual(manager.ids().sort(), ["a", "c"]);
});

test("reap is safe to call from every route, concurrently", async () => {
  // Reap on the way through whatever request is already in flight is the only
  // scheme that works on a serverless runtime, so two of them overlapping is
  // the normal case, not the exotic one.
  const { manager, disposed, tick } = fakes({ idleMs: 1000, delayMs: 5 });
  for (const id of ["a", "b", "c"]) await manager.get(id);
  tick(2000);

  const counts = await Promise.all([manager.reap(), manager.reap(), manager.reap(), manager.reap()]);
  assert.deepEqual(disposed.sort(), ["a", "b", "c"], "a session must never be disposed twice");
  assert.deepEqual(counts, [3, 3, 3, 3], "overlapping callers share one pass rather than each starting their own");
  assert.equal(manager.size, 0);
});

test("a failing dispose is reported, not thrown at whichever request swept", async () => {
  const warnings: string[] = [];
  let clock = 0;
  const manager = createSessionManager<Fake>({
    async create(id) {
      return { id, closed: false };
    },
    dispose() {
      throw new Error("browser would not shut down");
    },
    idleMs: 1000,
    onWarning: (m) => warnings.push(m),
    now: () => clock,
  });
  await manager.get("s1");
  clock += 2000;
  await manager.reap(); // eviction rides on an unrelated request; it must not fail it
  assert.equal(manager.size, 0);
  assert.match(warnings[0], /session "s1" failed to dispose: browser would not shut down/);
});

test("globalKey survives a module re-evaluation, sessions and all", async () => {
  // Next's dev server re-evaluates route modules on edit. A module-level Map
  // is dropped on every save, taking every live environment — and its worker
  // threads — with it, mid-conversation.
  const key = `__test_sessions_${Math.random().toString(36).slice(2)}`;
  const first = createSessionManager<Fake>({
    globalKey: key,
    async create(id) {
      return { id, closed: false };
    },
    dispose() {},
  });
  const session = await first.get("s1");

  const afterReload = createSessionManager<Fake>({
    globalKey: key,
    async create(id) {
      return { id, closed: false };
    },
    dispose() {},
  });
  assert.equal(afterReload, first);
  assert.equal(await afterReload.get("s1"), session);
  delete (globalThis as Record<string, unknown>)[key];
});

test("end and endAll release what they drop", async () => {
  const { manager, disposed } = fakes();
  await manager.get("a");
  await manager.get("b");

  assert.equal(await manager.end("a"), true);
  assert.equal(await manager.end("a"), false, "ending twice is not an error, and disposes once");
  assert.deepEqual(disposed, ["a"]);

  await manager.endAll();
  assert.deepEqual(disposed, ["a", "b"]);
  assert.equal(manager.size, 0);
});

test("eviction really shuts a working environment down", async () => {
  let clock = 0;
  const manager = createSessionManager({
    create: () => createWorkingEnvironment(),
    dispose: (env) => env.close(),
    idleMs: 1000,
    now: () => clock,
  });
  const env = await manager.get("s1");
  await env.fs.writeFile("/scripts/noop.js", "/** Noop. */\nexport default async function () { return 1; }\n");
  assert.equal((await env.runScript("/scripts/noop.js")).ok, true);

  clock += 2000;
  assert.equal(await manager.reap(), 1);
  // A closed environment refuses new mutations — the worker pool is down and
  // the thread is not still sitting there.
  await assert.rejects(() => env.fs.writeFile("/tmp/after.txt", "x"), /closed/);
});

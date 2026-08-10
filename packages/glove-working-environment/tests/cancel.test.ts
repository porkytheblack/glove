/**
 * Cancelling one run without closing the environment.
 *
 * The only ways a run could end early were the global deadline and `close()`,
 * which shuts the whole pool — so a host with a Stop button, or an SSE client
 * that hung up mid-render, had to rebuild the environment from a snapshot and
 * lose the warm worker to stop a single script.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkingEnvironment, defineTools } from "../src/index";
import { call } from "./helpers";

const SPIN_THEN_WRITE = `export default async function spin(args) {
  const fs = await import('env:fs');
  const until = Date.now() + args.ms;
  while (Date.now() < until) await null;
  await fs.writeFile('/out/finished.txt', 'the cancelled run kept going');
  return { finished: true };
}`;

test("a cancelled run resolves with a cancellation error and leaves the environment usable", async () => {
  const env = await createWorkingEnvironment({ limits: { runTimeoutMs: 30_000 } });
  try {
    await env.fs.writeFile("/scripts/spin.js", SPIN_THEN_WRITE);
    const controller = new AbortController();

    const started = Date.now();
    const running = env.runScript("/scripts/spin.js", { ms: 20_000 }, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 150));
    controller.abort();

    const run = await running;
    const elapsed = Date.now() - started;
    assert.equal(run.ok, false, "a cancelled run reported success");
    assert.match(run.error ?? "", /cancelled by the host/);
    assert.ok(elapsed < 5_000, `cancellation took ${elapsed}ms — it waited for the deadline instead`);

    // Nothing the cancelled run was about to do lands…
    assert.equal(await env.fs.exists("/out/finished.txt"), false, "a cancelled run still wrote its output");

    // …and the environment is still an environment: same instance, new run.
    await env.fs.writeFile("/scripts/after.js", `export default async function after() { return { ok: 1 }; }`);
    const next = await env.runScript("/scripts/after.js", {});
    assert.equal(next.ok, true, next.error ?? "");
    assert.deepEqual(next.result, { ok: 1 });
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("cancelling before the run starts refuses it outright", async () => {
  const env = await createWorkingEnvironment({});
  try {
    await env.fs.writeFile("/scripts/spin.js", SPIN_THEN_WRITE);
    const run = await env.runScript("/scripts/spin.js", { ms: 5_000 }, { signal: AbortSignal.abort() });
    assert.equal(run.ok, false);
    assert.match(run.error ?? "", /cancelled by the host/);
    assert.equal(await env.fs.exists("/out/finished.txt"), false);
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("the run_script verb inherits the host's signal", async () => {
  const env = await createWorkingEnvironment({ limits: { runTimeoutMs: 30_000 } });
  try {
    await env.fs.writeFile("/scripts/spin.js", SPIN_THEN_WRITE);
    const controller = new AbortController();
    const tool = env.tools.find((t) => t.name === "run_script")!;

    // The glove-core fold signature: (input, display, glove, signal).
    const pending = tool.do({ path: "/scripts/spin.js", args: { ms: 20_000 } }, undefined, undefined, controller.signal);
    await new Promise((r) => setTimeout(r, 150));
    controller.abort();

    const result = await pending;
    assert.equal(result.status, "error");
    assert.match(String(result.message), /cancelled by the host/);
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("a verb called with input alone still works — cancellation is opt-in", async () => {
  const env = await createWorkingEnvironment({});
  try {
    await env.fs.writeFile("/scripts/quick.js", `export default async function quick() { return { n: 7 }; }`);
    const out = await call(env, "run_script", { path: "/scripts/quick.js" });
    assert.equal(out.status, "success");
    assert.match(String(out.data), /"n": 7|"n":7/);
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("a defineTools capability receives the run's abort signal", async () => {
  // `ToolFnContext.signal` was declared from the start and never passed, so a
  // capability that wanted to honour cancellation could not.
  let sawSignal: AbortSignal | undefined;
  let abortedDuringCall = false;

  const env = await createWorkingEnvironment({
    limits: { runTimeoutMs: 30_000 },
    stdlib: [
      defineTools({
        name: "slowapi",
        description: "A capability that takes its time.",
        fns: [
          {
            name: "fetchThing",
            description: "Pretends to call a network.",
            async call(_args, ctx) {
              sawSignal = ctx?.signal;
              await new Promise<void>((resolve) => {
                const done = () => {
                  abortedDuringCall = true;
                  resolve();
                };
                if (ctx?.signal?.aborted) return done();
                ctx?.signal?.addEventListener("abort", done, { once: true });
                setTimeout(resolve, 20_000).unref?.();
              });
              return { fetched: true };
            },
          },
        ],
      }),
    ],
  });
  try {
    await env.fs.writeFile(
      "/scripts/uses.js",
      `export default async function uses() {
         const api = await import('env:slowapi');
         return await api.fetchThing({});
       }`,
    );
    const controller = new AbortController();
    const running = env.runScript("/scripts/uses.js", {}, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 200));
    controller.abort();

    const run = await running;
    assert.equal(run.ok, false);
    assert.ok(sawSignal instanceof AbortSignal, "the capability was called without a signal");
    assert.equal(abortedDuringCall, true, "the capability's signal never fired");
  } finally {
    await env.close({ graceMs: 200 });
  }
});

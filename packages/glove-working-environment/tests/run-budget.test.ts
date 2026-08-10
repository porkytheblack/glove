/**
 * Per-run budgets.
 *
 * There was one global `runTimeoutMs`, so permitting a single four-minute
 * render meant handing four minutes to every script in the environment —
 * including the accidental `for(;;)` that then holds the only warm worker for
 * the whole of it. Half the plumbing already existed: the deadline crossed the
 * thread in `RunMessage` and the worker recomputed its own from the limits,
 * ignoring it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkingEnvironment } from "../src/index";
import { call, callOk } from "./helpers";

/** Burns wall-clock without yielding usefully, so only a deadline stops it. */
const SPIN = `export default async function spin(args) {
  const until = Date.now() + args.ms;
  while (Date.now() < until) await null;
  return { finished: true };
}`;

test("a per-run budget below the ceiling is honoured", async () => {
  const env = await createWorkingEnvironment({ limits: { runTimeoutMs: 10_000 } });
  try {
    await env.fs.writeFile("/scripts/spin.js", SPIN);

    const started = Date.now();
    const run = await env.runScript("/scripts/spin.js", { ms: 5_000 }, { timeoutMs: 300 });
    const elapsed = Date.now() - started;

    assert.equal(run.ok, false, "the run outlived its own budget");
    assert.match(run.error ?? "", /wall-clock limit for this run: 300ms/);
    // …and it names the knob that would fix it, not the environment-wide one.
    assert.match(run.error ?? "", /timeout_ms/);
    assert.match(run.error ?? "", /allows up to 10000ms/);
    assert.ok(elapsed < 3_000, `waited ${elapsed}ms for a 300ms budget — the worker ignored the deadline`);
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("the environment ceiling still wins, and its message names limits.runTimeoutMs", async () => {
  const env = await createWorkingEnvironment({ limits: { runTimeoutMs: 400 } });
  try {
    await env.fs.writeFile("/scripts/spin.js", SPIN);

    const started = Date.now();
    // Asking for ten seconds in an environment that allows 400ms gets 400ms.
    const run = await env.runScript("/scripts/spin.js", { ms: 5_000 }, { timeoutMs: 10_000 });
    const elapsed = Date.now() - started;

    assert.equal(run.ok, false);
    assert.match(run.error ?? "", /limits\.runTimeoutMs/);
    assert.ok(elapsed < 3_000, `the ceiling was not applied: waited ${elapsed}ms`);
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("a run that fits its budget is unaffected", async () => {
  const env = await createWorkingEnvironment({ limits: { runTimeoutMs: 10_000 } });
  try {
    await env.fs.writeFile("/scripts/spin.js", SPIN);
    const run = await env.runScript("/scripts/spin.js", { ms: 50 }, { timeoutMs: 2_000 });
    assert.equal(run.ok, true, run.error ?? "");
    assert.deepEqual(run.result, { finished: true });
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("run_script exposes timeout_ms to the model, clamped to the ceiling", async () => {
  const env = await createWorkingEnvironment({ limits: { runTimeoutMs: 5_000 } });
  try {
    await env.fs.writeFile("/scripts/spin.js", SPIN);
    const tool = env.tools.find((t) => t.name === "run_script")!;
    const props = (tool.jsonSchema as { properties: Record<string, { description?: string }> }).properties;
    assert.ok(props.timeout_ms, "run_script does not offer timeout_ms");
    assert.match(props.timeout_ms.description ?? "", /5000/, "the description does not state the ceiling");

    const failed = await call(env, "run_script", { path: "/scripts/spin.js", args: { ms: 4_000 }, timeout_ms: 250 });
    assert.equal(failed.status, "error");
    assert.match(String(failed.message), /250ms/);

    // Nonsense falls back to the ceiling rather than producing a run with no
    // budget at all.
    const fine = await callOk(env, "run_script", { path: "/scripts/spin.js", args: { ms: 20 }, timeout_ms: -1 });
    assert.match(fine, /finished/);
  } finally {
    await env.close({ graceMs: 200 });
  }
});

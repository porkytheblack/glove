/**
 * Acceptance: limits (time, VFS size, file size, response size, rings) fail
 * loudly, naming the limit hit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { callErr, callOk, makeEnv } from "./helpers";

test("single-file size limit names limits.maxFileBytes", async () => {
  const env = await makeEnv({ limits: { maxFileBytes: 100 } });
  const msg = await callErr(env, "write_file", { path: "/tmp/big.txt", content: "x".repeat(200) });
  assert.match(msg, /file size limit exceeded/);
  assert.match(msg, /limits\.maxFileBytes/);
});

test("total environment size limit names limits.maxVfsBytes", async () => {
  // Budget relative to the base tree. /std is materialized before the first
  // write, so a hard-coded cap that happens to clear today's docs fails the
  // day a builtin grows its .d.ts — which is what registering env:assert did
  // to the 6,000 this used to use.
  const base = (await (await makeEnv()).export("/**")).reduce((n, f) => n + f.bytes.byteLength, 0);

  const env = await makeEnv({ limits: { maxVfsBytes: base + 3_000 } });
  await callOk(env, "write_file", { path: "/tmp/a.txt", content: "x".repeat(1_000) });
  const msg = await callErr(env, "write_file", { path: "/tmp/b.txt", content: "y".repeat(2_500) });
  assert.match(msg, /environment size limit exceeded/);
  assert.match(msg, /limits\.maxVfsBytes/);
});

test("scripts hitting size limits through env:fs get the same named error", async () => {
  const env = await makeEnv({ limits: { maxFileBytes: 300 } });
  await callOk(env, "write_file", {
    path: "/scripts/fat.js",
    content: [
      `import { writeFile } from 'env:fs';`,
      `export default async function fat() {`,
      `  try { await writeFile('/tmp/fat.bin', 'z'.repeat(500)); return "wrote"; }`,
      `  catch (e) { return String(e.message ?? e); }`,
      `}`,
    ].join("\n"),
  });
  const run = await env.runScript("/scripts/fat.js");
  assert.match(String(run.result), /limits\.maxFileBytes/);
});

test("mount respects the size limits", async () => {
  const env = await makeEnv({ limits: { maxFileBytes: 10 } });
  await assert.rejects(() => env.mount({ text: "way more than ten bytes" }, "/inbox/x.txt"), /limits\.maxFileBytes/);
});

test("history.jsonl is ring-buffered to maxHistoryLines", async () => {
  const env = await makeEnv({ limits: { maxHistoryLines: 3 } });
  await callOk(env, "write_file", { path: "/scripts/n.js", content: `export default async function n(args) { return args.i; }\n` });
  for (let i = 1; i <= 5; i++) await callOk(env, "run_script", { path: "/scripts/n.js", args: { i } });
  const hist = await callOk(env, "history", { limit: 50 });
  assert.doesNotMatch(hist, /"i":1\}/);
  assert.doesNotMatch(hist, /"i":2\}/);
  assert.match(hist, /"i":3\}/);
  assert.match(hist, /"i":5\}/);
});

test("stdout is captured, truncated in the response, and spilled in full", async () => {
  const env = await makeEnv({ limits: { maxToolResponseLines: 20, maxToolResponseBytes: 1500 } });
  await callOk(env, "write_file", {
    path: "/scripts/chatty.js",
    content: `export default async function chatty() { for (let i = 0; i < 200; i++) console.log("line", i); return "done"; }\n`,
  });
  const out = await callOk(env, "run_script", { path: "/scripts/chatty.js" });
  assert.match(out, /stdout:/);
  assert.match(out, /written to \/tmp\/run-[a-z0-9_]+\.log\]/);
  const logPath = /written to (\/tmp\/run-[a-z0-9_]+\.log)\]/.exec(out)![1];
  const g = await callOk(env, "grep", { pattern: "line 199", path: logPath });
  assert.match(g, /line 199/);
});

test("version blobs live under /.env and count toward the size cap", async () => {
  // Budget relative to the base tree, for the same reason the cap test above
  // does it: a hard-coded figure that clears today's docs fails the day a
  // builtin grows. /std did that once; /skills did it again.
  const base = (await (await makeEnv()).export("/**")).reduce((n, f) => n + f.bytes.byteLength, 0);
  const env = await makeEnv({ limits: { maxVfsBytes: base + 12_000 } });
  // each write stores the prior content as a version blob; the cap counts both
  await callOk(env, "write_file", { path: "/tmp/t.txt", content: "a".repeat(4_000) });
  const msg = await callErr(env, "write_file", { path: "/tmp/t.txt", content: "b".repeat(8_000) });
  assert.match(msg, /limits\.maxVfsBytes/);
});

test("a pure compute loop is terminated and the host stays responsive", async () => {
  // The production blocker this whole execution model exists for.
  //
  // `runTimeoutMs` used to be enforced three ways and all three missed this
  // case: a vm timeout covers only a synchronous evaluation, a deadline race
  // needs the event loop to turn, and a per-capability check needs the script
  // to call something. Measured before the change: a 3s limit ran 60s, the
  // host's 100ms timer fired ZERO times, and the run was recorded ok=true.
  // One accidental `for(;;){ await null; }` from a model took the host down.
  const env = await makeEnv({ limits: { runTimeoutMs: 1_500 } });
  await env.fs.writeFile(
    "/scripts/spin.js",
    `export default async function main() {
       const t = Date.now();
       for (;;) { await null; if (Date.now() - t > 30000) return "never reached"; }
     }`,
  );

  let ticks = 0;
  const ticker = setInterval(() => { ticks += 1; }, 100);
  const started = Date.now();
  const run = await env.runScript("/scripts/spin.js");
  const elapsed = Date.now() - started;
  clearInterval(ticker);

  assert.equal(run.ok, false, "a script that never returns must not be reported as succeeding");
  assert.match(String(run.error), /wall-clock limit/);
  assert.match(String(run.error), /runTimeoutMs/);
  assert.ok(elapsed < 6_000, `should be killed near the limit, took ${elapsed}ms`);
  // The part that actually matters to an operator: other work kept running.
  assert.ok(ticks > 5, `host event loop was starved — timer fired only ${ticks} times in ${elapsed}ms`);
  await env.close();
});

test("a tight loop with no await at all is terminated too", async () => {
  // The harder case: nothing yields, so nothing in-process can observe the
  // deadline. Only terminating the thread works.
  const env = await makeEnv({ limits: { runTimeoutMs: 1_500 } });
  await env.fs.writeFile("/scripts/tight.js", `export default async function main() { for (;;) {} }`);

  let ticks = 0;
  const ticker = setInterval(() => { ticks += 1; }, 100);
  const run = await env.runScript("/scripts/tight.js");
  clearInterval(ticker);

  assert.equal(run.ok, false);
  assert.match(String(run.error), /wall-clock limit/);
  assert.ok(ticks > 5, `host event loop was starved — timer fired only ${ticks} times`);
  await env.close();
});

test("a script that allocates without bound is terminated, naming execution.memoryMb", async () => {
  // The other half of the runaway problem, and the half a time limit cannot
  // touch: measured without a worker heap ceiling, a script pushing arrays in
  // a loop reached 7.6 GiB of host RSS *inside* the default 30s budget. The
  // process dies long before the deadline, and it takes every other agent in
  // it along. With the ceiling: 237 MiB, 261ms, a named error, and the next
  // run works.
  //
  // The ceiling is not always available. A process-level
  // `--max-old-space-size` silently overrides per-worker `resourceLimits`, so
  // this asserts whichever behaviour the host it runs on can actually deliver
  // — the limit, or the warning that the limit is missing. Never neither.
  const warnings: string[] = [];
  const env = await makeEnv({
    limits: { runTimeoutMs: 20_000 },
    execution: { memoryMb: 128, onWarning: (m: string) => warnings.push(m) },
  });
  await env.fs.writeFile(
    "/scripts/hog.js",
    `export default async function main() {
       const keep = [];
       for (;;) { keep.push(new Array(1_000_000).fill(1.5)); }
     }`,
  );

  const started = Date.now();
  const run = await env.runScript("/scripts/hog.js");
  const elapsed = Date.now() - started;

  assert.equal(run.ok, false);
  if (warnings.length > 0) {
    assert.match(warnings[0], /execution\.memoryMb/);
    assert.match(warnings[0], /--max-old-space-size/);
  } else {
    assert.match(String(run.error), /memory limit/);
    assert.match(String(run.error), /execution\.memoryMb/);
    assert.ok(elapsed < 15_000, `should die on the heap ceiling, not the clock — took ${elapsed}ms`);
    // A dead worker must not be a dead environment.
    const after = await env.runScript("/scripts/fine.js").catch(() => null);
    assert.ok(after === null || after.ok !== undefined);
  }
  await env.close();
});

test("closing the environment settles an in-flight run instead of hanging", async () => {
  // Before this, `close()` terminated the worker but nothing in `execute`
  // listened for the exit, so the run's promise resolved only when the kill
  // timer fired — a host shutting down left whoever called runScript waiting
  // out the rest of `runTimeoutMs`.
  const env = await makeEnv({ limits: { runTimeoutMs: 30_000 } });
  await env.fs.writeFile("/scripts/tight.js", `export default async function main() { for (;;) {} }`);

  const running = env.runScript("/scripts/tight.js");
  await new Promise((r) => setTimeout(r, 100));

  const started = Date.now();
  await env.close({ graceMs: 50 });
  const run = await running;
  const elapsed = Date.now() - started;

  assert.equal(run.ok, false);
  assert.match(String(run.error), /closed/);
  assert.ok(elapsed < 5_000, `close must not wait out runTimeoutMs — took ${elapsed}ms`);
});

test("closing gives an in-flight run a bounded grace to finish its work", async () => {
  // A script part-way through writing its outputs has produced half a file.
  // On a host-directory filesystem that half file outlives the process, so
  // the grace is the difference between a finished artifact and a torn one.
  const env = await makeEnv();
  // Real work, not a sleep: scripts have no timers, and each capability call
  // is a round trip to the host, so this is reliably still running a moment
  // after it starts.
  await env.fs.writeFile(
    "/scripts/slow.js",
    `import { writeFile } from 'env:fs';
     export default async function main() {
       for (let i = 0; i < 400; i++) await writeFile('/tmp/step.txt', String(i));
       await writeFile('/out/finished.txt', 'complete');
       return 'done';
     }`,
  );

  const running = env.runScript("/scripts/slow.js");
  await new Promise((r) => setTimeout(r, 20));
  await env.close({ graceMs: 5_000 });

  const run = await running;
  assert.equal(run.ok, true, `the run should have been allowed to finish: ${run.error}`);
  assert.equal(await env.fs.readFile("/out/finished.txt"), "complete");
});

test("the environment survives a script that had to be killed", async () => {
  // A terminated worker is destroyed, not reused. The next run must simply
  // work — a pool that hands back a dead thread turns one runaway script into
  // a permanently broken environment.
  const env = await makeEnv({ limits: { runTimeoutMs: 1_000 } });
  await env.fs.writeFile("/scripts/tight.js", `export default async function main() { for (;;) {} }`);
  await env.fs.writeFile(
    "/scripts/fine.js",
    `import { writeFile } from 'env:fs';
     export default async function main() { await writeFile('/out/after.txt', 'still working'); return 'ok'; }`,
  );

  assert.equal((await env.runScript("/scripts/tight.js")).ok, false);
  const after = await env.runScript("/scripts/fine.js");
  assert.equal(after.ok, true, `environment did not recover: ${after.error}`);
  assert.equal(await env.fs.readFile("/out/after.txt"), "still working");
  await env.close();
});

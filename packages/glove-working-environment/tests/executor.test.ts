/**
 * Acceptance: relative VFS imports and env:* imports work; bare specifiers
 * fail with the helpful message; circular imports are detected; scripts
 * cannot reach network/host/process; limits fail loudly, naming the limit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { callErr, callOk, makeEnv } from "./helpers";

test("relative imports between scripts compose (script-to-script library)", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/parse_invoice.js",
    content: `/** Parses an invoice line. */\nexport default async function parseInvoice(args) { return { id: args.raw.trim() }; }\n`,
  });
  await callOk(env, "write_file", {
    path: "/scripts/process.js",
    content: [
      `import parseInvoice from './parse_invoice.js';`,
      `export default async function process(args) {`,
      `  const parsed = await parseInvoice({ raw: args.raw });`,
      `  return { got: parsed.id };`,
      `}`,
    ].join("\n"),
  });
  const run = await env.runScript("/scripts/process.js", { raw: "  inv-42  " });
  assert.equal(run.ok, true);
  assert.deepEqual(run.result, { got: "inv-42" });
});

test("env:fs and env:std are importable; scripts loop over files without tool calls", async () => {
  const env = await makeEnv();
  await env.mount({ text: "a,b\n1,2\n3,4\n" }, "/inbox/one.csv");
  await env.mount({ text: "a,b\n5,6\n" }, "/inbox/two.csv");
  await callOk(env, "write_file", {
    path: "/scripts/sum_all.js",
    content: [
      `import { glob, readFile, writeFile } from 'env:fs';`,
      `import { csv } from 'env:std';`,
      `export default async function sumAll() {`,
      `  let sum = 0;`,
      `  for (const p of await glob('/inbox/*.csv')) {`,
      `    for (const rec of csv.parse(await readFile(p))) sum += Number(rec.a) + Number(rec.b);`,
      `  }`,
      `  await writeFile('/out/sum.txt', String(sum));`,
      `  return { sum, output: '/out/sum.txt' };`,
      `}`,
    ].join("\n"),
  });
  const run = await env.runScript("/scripts/sum_all.js");
  assert.equal(run.ok, true);
  assert.deepEqual(run.result, { sum: 21, output: "/out/sum.txt" });
  const exported = await env.export("/out/**");
  assert.equal(exported.length, 1);
  assert.equal(new TextDecoder().decode(exported[0].bytes), "21");
});

test("bare specifiers fail with the message listing available env modules", async () => {
  const env = await makeEnv();
  const msg = await callErr(env, "write_file", {
    path: "/scripts/lodashy.js",
    content: `import _ from "lodash";\nexport default async function f() { return _; }\n`,
  });
  assert.match(msg, /only relative VFS paths and env:\* modules can be imported \(got "lodash"\)/);
  assert.match(msg, /Available env modules: env:fs, env:std/);
});

test("unknown env module lists what exists", async () => {
  const env = await makeEnv();
  const msg = await callErr(env, "write_file", {
    path: "/scripts/x.js",
    content: `import { pdf } from "env:documents";\nexport default async function f() { return 1; }\n`,
  });
  assert.match(msg, /unknown module "env:documents"\. Available env modules: env:fs, env:std/);
});

test("circular imports are detected and the cycle path is listed", async () => {
  const env = await makeEnv();
  // Write b first without the cycle so it validates, then close the loop via /tmp staging.
  await callOk(env, "write_file", {
    path: "/scripts/b.js",
    content: `export default async function b() { return "b"; }\n`,
  });
  await callOk(env, "write_file", {
    path: "/scripts/a.js",
    content: `import b from './b.js';\nexport default async function a() { return b(); }\n`,
  });
  const msg = await callErr(env, "edit_file", {
    path: "/scripts/b.js",
    old_str: `export default async function b() { return "b"; }`,
    new_str: `import a from './a.js';\nexport default async function b() { return a(); }`,
  });
  assert.match(msg, /circular import detected: \/scripts\/b\.js -> \/scripts\/a\.js -> \/scripts\/b\.js/);
});

test("missing relative import names the file it tried", async () => {
  const env = await makeEnv();
  const msg = await callErr(env, "write_file", {
    path: "/scripts/x.js",
    content: `import y from './nope.js';\nexport default async function x() { return y; }\n`,
  });
  assert.match(msg, /cannot import "\.\/nope\.js" from \/scripts\/x\.js: no such file \/scripts\/nope\.js/);
});

test("importing a missing named export names the module and the binding", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/lib/u.js", content: `export const one = 1;\n` });
  const msg = await callErr(env, "write_file", {
    path: "/scripts/x.js",
    content: `import { two } from './lib/u.js';\nexport default async function x() { return two; }\n`,
  });
  assert.match(msg, /module "\.\/lib\/u\.js" has no export "two"/);
});

test("the sandbox scope has no fetch, process, require, timers, host fs, or WebAssembly", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/probe.js",
    content: [
      `export default async function probe() {`,
      `  return {`,
      `    fetch: typeof fetch, process: typeof process, require: typeof require,`,
      `    setTimeout: typeof setTimeout, setInterval: typeof setInterval,`,
      `    XMLHttpRequest: typeof XMLHttpRequest, WebSocket: typeof WebSocket,`,
      `    Buffer: typeof Buffer, WebAssembly: typeof WebAssembly,`,
      `    queueMicrotask: typeof queueMicrotask,`,
      `    JSON: typeof JSON, Math: typeof Math, Promise: typeof Promise, Date: typeof Date,`,
      `  };`,
      `}`,
    ].join("\n"),
  });
  const run = await env.runScript("/scripts/probe.js");
  assert.equal(run.ok, true);
  const r = run.result as Record<string, string>;
  for (const absent of ["fetch", "process", "require", "setTimeout", "setInterval", "XMLHttpRequest", "WebSocket", "Buffer", "WebAssembly", "queueMicrotask"]) {
    assert.equal(r[absent], "undefined", `${absent} must be absent`);
  }
  for (const present of ["JSON", "Math", "Promise", "Date"]) {
    assert.notEqual(r[present], "undefined", `${present} must exist`);
  }
});

test("dynamic import() works and is sandbox-scoped", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/lib/late.js", content: `export const n = 7;\n` });
  await callOk(env, "write_file", {
    path: "/scripts/dyn.js",
    content: `export default async function dyn() {\n  const m = await import('./lib/late.js');\n  return m.n;\n}\n`,
  });
  const run = await env.runScript("/scripts/dyn.js");
  assert.equal(run.result, 7);
});

test("import.meta is rejected with a clear error", async () => {
  const env = await makeEnv();
  const msg = await callErr(env, "write_file", {
    path: "/scripts/meta.js",
    content: `export default async function f() { return import.meta.url; }\n`,
  });
  assert.match(msg, /import\.meta is not available/);
});

test("a synchronous infinite loop hits the wall-clock limit, naming it", async () => {
  const env = await makeEnv({ limits: { runTimeoutMs: 300 } });
  await callOk(env, "write_file", {
    path: "/scripts/spin.js",
    content: `export default async function spin() { while (true) {} }\n`,
  });
  const run = await env.runScript("/scripts/spin.js");
  assert.equal(run.ok, false);
  assert.match(run.error!, /wall-clock limit: 300ms \(limits\.runTimeoutMs\)/);
});

test("a never-resolving promise hits the wall-clock limit too", async () => {
  const env = await makeEnv({ limits: { runTimeoutMs: 300 } });
  await callOk(env, "write_file", {
    path: "/scripts/hang.js",
    content: `export default async function hang() { return new Promise(() => {}); }\n`,
  });
  const run = await env.runScript("/scripts/hang.js");
  assert.equal(run.ok, false);
  assert.match(run.error!, /wall-clock limit/);
});

test("console output is captured as stdout/stderr, not printed", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/noisy.js",
    content: [
      `export default async function noisy() {`,
      `  console.log("step", 1, { deep: true });`,
      `  console.error("uh oh");`,
      `  return "done";`,
      `}`,
    ].join("\n"),
  });
  const run = await env.runScript("/scripts/noisy.js");
  assert.match(run.stdout, /step 1 \{ deep: true \}/);
  assert.match(run.stderr, /uh oh/);
});

test("script runtime errors surface the message and script stack frames", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/boom.js",
    content: `export default async function boom() {\n  throw new Error("kapow");\n}\n`,
  });
  const run = await env.runScript("/scripts/boom.js");
  assert.equal(run.ok, false);
  assert.match(run.error!, /kapow/);
  assert.match(run.error!, /\/scripts\/boom\.js:2/); // line numbers map to the original source
});

test("frozen env modules cannot be mutated by scripts", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/tamper.js",
    content: [
      `import fs from 'env:fs';`,
      `import { csv } from 'env:std';`,
      `export default async function tamper() {`,
      `  let poisoned = false;`,
      `  try { fs.readFile = () => "hacked"; poisoned = typeof fs.readFile === 'function' && fs.readFile() === "hacked"; } catch {}`,
      `  try { csv.parse = () => []; } catch {}`,
      `  return { poisoned };`,
      `}`,
    ].join("\n"),
  });
  const run = await env.runScript("/scripts/tamper.js");
  assert.deepEqual(run.result, { poisoned: false });
});

test("scripts can write scripts through env:fs — and validation still applies", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/author.js",
    content: [
      `import { writeFile } from 'env:fs';`,
      `export default async function author(args) {`,
      `  try {`,
      `    await writeFile('/scripts/generated.js', args.body);`,
      `    return { wrote: true };`,
      `  } catch (e) { return { wrote: false, error: String(e.message ?? e) }; }`,
      `}`,
    ].join("\n"),
  });
  const good = await env.runScript("/scripts/author.js", { body: "export default async function g() { return 9; }" });
  assert.deepEqual(good.result, { wrote: true });
  const gen = await env.runScript("/scripts/generated.js");
  assert.equal(gen.result, 9);

  const bad = await env.runScript("/scripts/author.js", { body: "const nope = 1;" });
  assert.equal((bad.result as { wrote: boolean }).wrote, false);
  assert.match((bad.result as { error: string }).error, /no default export/);
});

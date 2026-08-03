/**
 * Regression tests for defects found by adversarial audit. Each test pins a
 * specific repro that was confirmed broken, so the fix can't silently rot.
 *
 * Three structural causes produced most of them, and each is worth stating
 * because the tests below are only samples of the class:
 *
 *  1. Mutations committed BEFORE their derived/dependent effects, with no
 *     rollback — so a verb could report failure after changing the tree.
 *  2. Write-time validation executing module top-level code against a LIVE
 *     filesystem — so a rejected write could still delete files.
 *  3. Byte budgets that were really line budgets, plus write paths that
 *     bypassed the guarded gateway entirely.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkingEnvironment } from "../src/index";
import { call, callErr, callOk, makeEnv } from "./helpers";

async function treeBytes(env: Awaited<ReturnType<typeof makeEnv>>): Promise<number> {
  const snap = await env.snapshot();
  return snap.files.reduce((n, f) => n + Buffer.from(f.data, "base64").length, 0);
}

// ---------------------------------------------------- bounded model output

test("a huge thrown error does not reach the model untruncated", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/boom.js",
    content: `export default async function boom(){ throw new Error("E".repeat(5000000)); }`,
  });
  const r = await call(env, "run_script", { path: "/scripts/boom.js" });
  assert.equal(r.status, "error");
  const delivered = String(r.data ?? "").length + String(r.message ?? "").length;
  assert.ok(delivered < 40_000, `error path delivered ${delivered} chars to the model`);
});

test("a single enormous line is truncated AND spilled, with the path named", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/one.js",
    content: `export default async function one(){ return "x".repeat(5000000); }`,
  });
  const out = await callOk(env, "run_script", { path: "/scripts/one.js" });
  assert.ok(out.length < 40_000, `response was ${out.length} chars`);
  const named = /written to (\/tmp\/run-[^\]]+)\]/.exec(out);
  assert.ok(named, "oversized single-line output must name a spill file");
  // …and that file must really exist (line-count budgets used to skip the spill).
  await callOk(env, "read_file", { path: named![1], start_line: 1, end_line: 1 });
});

test("read_file is bounded by bytes, not just by line count", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/tmp/fat.txt", content: Array(400).fill("a".repeat(5000)).join("\n") });
  const out = await callOk(env, "read_file", { path: "/tmp/fat.txt" });
  assert.ok(out.length < 40_000, `read_file returned ${out.length} chars`);
});

test("history.jsonl stays bounded under huge args and huge errors", async () => {
  const env = await makeEnv({ limits: { maxHistoryLines: 5 } });
  await callOk(env, "write_file", { path: "/scripts/noop.js", content: `export default async function noop(a){ return 1; }` });
  for (let i = 0; i < 6; i++) {
    await callOk(env, "run_script", { path: "/scripts/noop.js", args: { pad: "P".repeat(200_000) } });
  }
  await callOk(env, "write_file", { path: "/scripts/err.js", content: `export default async function err(){ throw new Error("E".repeat(500000)); }` });
  await call(env, "run_script", { path: "/scripts/err.js" });

  const snap = await env.snapshot();
  const hist = snap.files.find((f) => f.path === "/.env/history.jsonl");
  const bytes = hist ? Buffer.from(hist.data, "base64").length : 0;
  assert.ok(bytes > 0 && bytes < 100_000, `history.jsonl grew to ${bytes} bytes`);
});

test("the derived .d.ts counts against the size limits", async () => {
  const env = await createWorkingEnvironment({ limits: { maxFileBytes: 10_000, maxVfsBytes: 15_000 } });
  const params = Array.from({ length: 2000 }, (_, i) => `a${i}`).join(",");
  const r = await call(env, "write_file", { path: "/scripts/amp.js", content: `export default async function amp({${params}}) { return 1; }` });
  const bytes = await treeBytes(env);
  assert.ok(r.status === "error" || bytes <= 15_000, `tree reached ${bytes} bytes against a 15,000 cap (status ${r.status})`);
});

// ------------------------------------------- failed operations are inert

test("a rejected write_file commits no side effects from its top-level code", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/out/important.txt", content: "KEEP" });
  const msg = await callErr(env, "write_file", {
    path: "/scripts/evil.js",
    content: `import { rm } from 'env:fs';\nawait rm('/out/important.txt');\nexport const notDefault = 1;\n`,
  });
  assert.match(msg, /not available while a script is being validated/);
  assert.match(await callOk(env, "read_file", { path: "/out/important.txt" }), /KEEP/);
});

test("a failed directory mv leaves the source completely intact", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/src/a/x.txt", content: "AAA" });
  await callOk(env, "write_file", { path: "/src/b/y.txt", content: "BBB" });
  await callOk(env, "write_file", { path: "/dst/b", content: "a file in the way" });

  const msg = await callErr(env, "mv", { from: "/src", to: "/dst" });
  assert.match(msg, /\/dst\/b/);
  // Nothing may be half-moved: both sources survive.
  assert.match(await callOk(env, "read_file", { path: "/src/a/x.txt" }), /AAA/);
  assert.match(await callOk(env, "read_file", { path: "/src/b/y.txt" }), /BBB/);
});

test("a write whose derived .d.ts cannot be produced does not commit the .js", async () => {
  const env = await makeEnv();
  const msg = await callErr(env, "write_file", {
    path: "/scripts/k.js",
    content: `import { mkdir } from 'env:fs';\nawait mkdir('/scripts/k.d.ts/x');\nexport default async function k(){ return 1 }\n`,
  });
  assert.match(msg, /not available while a script is being validated/);
  assert.match(await callErr(env, "read_file", { path: "/scripts/k.js" }), /no such file/);
  // …and the script name is not poisoned for future writes.
  await callOk(env, "write_file", { path: "/scripts/k.js", content: `export default async function k(){ return 1 }` });
});

test("nothing can create a directory at a generated .d.ts path", async () => {
  const env = await makeEnv();
  // Directly, and beneath it — a recursive remove there would take
  // unversioned user data with it.
  assert.match(await callErr(env, "write_file", { path: "/scripts/y.d.ts/notes/keep.txt", content: "x" }), /derived/);
  assert.match(await callErr(env, "write_file", { path: "/scripts/lib/z.d.ts/a.txt", content: "x" }), /derived/);
});

test("undo reports failure only when it actually failed", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/u.js", content: `export default async function u(){return 1}` });
  await callOk(env, "rm", { path: "/scripts/u.js" });
  await callErr(env, "write_file", { path: "/scripts/u.d.ts/x", content: "." }); // now blocked outright
  const out = await callOk(env, "undo", { path: "/scripts/u.js" });
  assert.match(out, /file restored/);
  assert.match(await callOk(env, "read_file", { path: "/scripts/u.js" }), /function u/);
  assert.match(await callOk(env, "read_file", { path: "/scripts/u.d.ts" }), /declare function u/);
});

// ------------------------------------------------------------ concurrency

test("concurrent writes each record their own undo version", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/c.txt", content: "V0" });
  await Promise.all(["V1", "V2", "V3", "V4"].map((v) => call(env, "write_file", { path: "/c.txt", content: v })));

  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    const u = await call(env, "undo", { path: "/c.txt" });
    if (u.status !== "success") break;
    const read = await call(env, "read_file", { path: "/c.txt" });
    if (read.status === "success") seen.push(String(read.data).replace(/^\s*1\t/, "").trim());
  }
  // Every intermediate version must be reachable — a read-modify-write race
  // used to record "V0" four times and lose V1..V3 entirely.
  assert.equal(new Set(seen).size, seen.length, `undo chain repeated a version: ${seen.join(" -> ")}`);
  assert.ok(seen.length >= 4, `expected 4 distinct versions behind, walked ${seen.join(" -> ")}`);
});

test("concurrent script writes through env:fs stay consistent", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/w.js",
    content: `import { writeFile } from 'env:fs';
export default async function w(args) { await writeFile('/tmp/shared.txt', args.v); return args.v; }`,
  });
  await Promise.all([1, 2, 3, 4, 5].map((v) => env.runScript("/scripts/w.js", { v: `value-${v}` })));
  const hist = await callOk(env, "history", { path: "/tmp/shared.txt" });
  assert.match(hist, /version\(s\) behind/);
  const final = await callOk(env, "read_file", { path: "/tmp/shared.txt" });
  assert.match(final, /value-[1-5]/);
});

// ------------------------------------------------------------- wall clock

test("a loop that uses its capabilities is stopped at the wall-clock limit", async () => {
  const env = await makeEnv({ limits: { runTimeoutMs: 800 } });
  await callOk(env, "write_file", {
    path: "/scripts/slow.js",
    content: `import { stat } from 'env:fs';
export default async function slow(){ for (let i = 0; i < 1e9; i++) { if (i % 500 === 0) await stat('/tmp'); } return "finished"; }`,
  });
  const started = Date.now();
  const r = await call(env, "run_script", { path: "/scripts/slow.js" });
  const elapsed = Date.now() - started;
  assert.equal(r.status, "error");
  assert.match(String(r.message), /wall-clock limit/);
  assert.ok(elapsed < 5_000, `took ${elapsed}ms against an 800ms limit`);
});

// --------------------------------------------- ESM semantics (differential)

test("declarator lists survive templates, divisions, and keyword-like properties", async () => {
  const env = await makeEnv();
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ["template", "export const a = `${1}`, c = 2;", { a: "1", c: 2 }],
    ["division after string", `export const a = "6" / 2, b = 3;`, { a: 3, b: 3 }],
    ["two divisions", `export const ratio = "6" / 2, half = 1 / 2;`, { ratio: 3, half: 0.5 }],
    ["property named in", "const o = { in: 4 };\nexport const a = o.in / 2, b = 3;", { a: 2, b: 3 }],
    ["comma-first", "export const a = 1\n  , b = 2;", { a: 1, b: 2 }],
  ];
  for (const [name, src, expected] of cases) {
    await callOk(env, "write_file", { path: `/scripts/lib/${name.replace(/\W/g, "_")}.js`, content: src });
    await callOk(env, "write_file", {
      path: "/scripts/probe.js",
      content: `import * as ns from './lib/${name.replace(/\W/g, "_")}.js';
export default async function probe(){ const o = {}; for (const k of ${JSON.stringify(Object.keys(expected))}) o[k] = ns[k]; return o; }`,
    });
    const run = await env.runScript("/scripts/probe.js");
    assert.deepEqual(run.result, expected, `${name}: wrong exports`);
  }
});

test("a private binding never leaks into the module namespace", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/lib/leak.js",
    content: "const q = 'SECRET';\nexport const a = `${1}`;\nfunction g(p, q){ return p; }\n",
  });
  await callOk(env, "write_file", {
    path: "/scripts/probe.js",
    content: `import * as ns from './lib/leak.js';
export default async function probe(){ return Object.keys(ns).filter(k => k !== 'default').sort(); }`,
  });
  const run = await env.runScript("/scripts/probe.js");
  assert.deepEqual(run.result, ["a"], "a module-private const leaked into the namespace");
});

test("string contents are never rewritten by the transform", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/strs.js",
    content: `const a = "6" / 2 + "p./q";\nconst t = "export default 9;";\n// "\nexport default async function strs(){ return t; }`,
  });
  const run = await env.runScript("/scripts/strs.js");
  assert.equal(run.result, "export default 9;");
});

test("generators, hashbangs, import attributes, and specifier comments all work", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/lib/dep.js", content: "export const b = 5;\nexport function *gen(){ yield 1; }\n" });
  await callOk(env, "write_file", {
    path: "/scripts/mixed.js",
    content: [
      `#!/usr/bin/env node`,
      `import { /* keep */ b } from './lib/dep.js' with { };`,
      `export default async function mixed(){ return b; }`,
    ].join("\n"),
  });
  const run = await env.runScript("/scripts/mixed.js");
  assert.equal(run.result, 5);

  await callOk(env, "write_file", {
    path: "/scripts/gen.js",
    content: `export default function *g(){ yield 1; }\n`,
  });
  const genRun = await env.runScript("/scripts/gen.js");
  assert.equal(genRun.ok, true);
});

test("a method named `import` is not rewritten", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/meth.js",
    content: `class A { import(){ return 2; } }\nexport default async function meth(){ return new A().import(); }`,
  });
  const run = await env.runScript("/scripts/meth.js");
  assert.equal(run.result, 2);
});

test("a long function name after wide whitespace is captured correctly", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/lib/wide.js",
    content: `const my = "WRONG";\nexport default function${" ".repeat(190)}myLongFunctionName(){ return "right"; }\n`,
  });
  await callOk(env, "write_file", {
    path: "/scripts/probe.js",
    content: `import d from './lib/wide.js';\nexport default async function probe(){ return typeof d === 'function' ? d() : d; }`,
  });
  const run = await env.runScript("/scripts/probe.js");
  assert.equal(run.result, "right");
});

test("hint matching cannot be made quadratic by a huge thrown message", async () => {
  // The hints appended to a failed run pattern-match the error text, which is
  // script-controlled and unbounded. An unanchored `\w+` over half a megabyte
  // of one repeated word character backtracks quadratically — the suite hung
  // rather than failed, which is the worse outcome.
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/huge.js",
    content: `export default async function huge() { throw new Error("E".repeat(500000)); }`,
  });
  const started = Date.now();
  const r = await call(env, "run_script", { path: "/scripts/huge.js" });
  assert.equal(r.status, "error");
  assert.ok(Date.now() - started < 5_000, `hint matching took ${Date.now() - started}ms on a 500KB message`);
});

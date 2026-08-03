/**
 * Unit tests for the ESM transform + the executor's handling of trickier
 * module shapes (strings/comments/regexes containing keywords, export
 * variants, .js-less specifiers).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { transformModule, TransformError } from "../src/executor/transform";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { callErr, callOk, makeEnv } from "./helpers";

test("keywords inside strings, comments, templates, and regex literals are untouched", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/tricky.js",
    content: [
      `// import fake from "lodash" — a comment, not an import`,
      `/* export default nothing */`,
      `const s = "import x from 'lodash';";`,
      "const t = `export default ${s}`;",
      `const re = /import ['"]x['"]/;`,
      `const division = 10 / 2 / 1;`,
      `export default async function tricky() { return { s, t: t.length, re: re.source, division }; }`,
    ].join("\n"),
  });
  const run = await env.runScript("/scripts/tricky.js");
  assert.equal(run.ok, true);
  const r = run.result as Record<string, unknown>;
  assert.equal(r.s, "import x from 'lodash';");
  assert.equal(r.division, 5);
});

test("export variants: const lists, named lists with aliases, declarations, default-as", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/lib/many.js",
    content: [
      `export const a = 1, b = 2;`,
      `export let c = 3;`,
      `export function dbl(n) { return n * 2; }`,
      `export class Box { constructor(v) { this.v = v; } }`,
      `const hidden = 9;`,
      `export { hidden as nine };`,
    ].join("\n"),
  });
  await callOk(env, "write_file", {
    path: "/scripts/use.js",
    content: [
      `import { a, b, c, dbl, Box, nine } from './lib/many.js';`,
      `import * as many from './lib/many.js';`,
      `export default async function use() {`,
      `  return { a, b, c, dbl: dbl(4), box: new Box(5).v, nine, keys: Object.keys(many).filter(k => k !== 'default').sort() };`,
      `}`,
    ].join("\n"),
  });
  const run = await env.runScript("/scripts/use.js");
  assert.deepEqual(run.result, {
    a: 1, b: 2, c: 3, dbl: 8, box: 5, nine: 9,
    keys: ["Box", "a", "b", "c", "dbl", "nine"], // `hidden` itself is NOT exported
  });
});

test("re-exports: export { x } from and export * from", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/lib/base.js", content: `export const one = 1;\nexport const two = 2;\n` });
  await callOk(env, "write_file", {
    path: "/scripts/lib/facade.js",
    content: `export { one as uno } from './base.js';\nexport * from './base.js';\n`,
  });
  await callOk(env, "write_file", {
    path: "/scripts/use.js",
    content: `import { uno, one, two } from './lib/facade.js';\nexport default async function use() { return uno + one + two; }\n`,
  });
  const run = await env.runScript("/scripts/use.js");
  assert.equal(run.result, 4);
});

test("export { fn as default } satisfies the contract", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/aliased.js",
    content: `async function work(args) { return args.x * 3; }\nexport { work as default };\n`,
  });
  const run = await env.runScript("/scripts/aliased.js", { x: 5 });
  assert.equal(run.result, 15);
});

test("default export name stays usable inside the module (recursion)", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/fact.js",
    content: [
      `export default async function fact(args) {`,
      `  const n = typeof args === 'number' ? args : args.n;`,
      `  return n <= 1 ? 1 : n * (await fact(n - 1));`,
      `}`,
    ].join("\n"),
  });
  const run = await env.runScript("/scripts/fact.js", { n: 5 });
  assert.equal(run.result, 120);
});

test("arrow-function default exports work", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/arrow.js", content: `export default async (args) => args.v + 1;\n` });
  const run = await env.runScript("/scripts/arrow.js", { v: 1 });
  assert.equal(run.result, 2);
});

test("extension-less relative specifiers resolve to .js", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/lib/helper.js", content: `export const k = "ok";\n` });
  await callOk(env, "write_file", {
    path: "/scripts/use.js",
    content: `import { k } from './lib/helper';\nexport default async function use() { return k; }\n`,
  });
  const run = await env.runScript("/scripts/use.js");
  assert.equal(run.result, "ok");
});

test("a malformed destructuring pattern still fails with a located message", () => {
  // Destructuring exports themselves are supported (see the differential
  // tests below); what remains loud is a pattern that is not a pattern.
  assert.throws(
    () => transformModule(`export const { 1: } = obj;\nexport default async () => 1;`, "/scripts/x.js"),
    (e: unknown) => e instanceof TransformError && /\/scripts\/x\.js:1:/.test((e as Error).message),
  );
});

test("import.meta names the line", () => {
  assert.throws(
    () => transformModule(`const x = 1;\nconst y = import.meta.url;`, "/scripts/x.js"),
    /\/scripts\/x\.js:2: import\.meta is not available/,
  );
});

test("top-level await works in scripts (module bodies are async)", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/tmp/seed.txt", content: "seeded" });
  await callOk(env, "write_file", {
    path: "/scripts/tla.js",
    content: [
      `import { readFile } from 'env:fs';`,
      `const seed = await readFile('/tmp/seed.txt');`,
      `export default async function tla() { return seed; }`,
    ].join("\n"),
  });
  const run = await env.runScript("/scripts/tla.js");
  assert.equal(run.result, "seeded");
});

test("module top-level code cannot mutate the tree — validation executes it", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/out/keep.txt", content: "precious" });
  const msg = await callErr(env, "write_file", {
    path: "/scripts/sneaky.js",
    content: [
      `import { rm } from 'env:fs';`,
      `await rm('/out/keep.txt');`,
      `export default async function sneaky() { return 1; }`,
    ].join("\n"),
  });
  assert.match(msg, /rm is not available while a script is being validated/);
  assert.match(msg, /Do the work inside the default export instead/);
  // The file the module tried to delete during validation is untouched.
  assert.match(await callOk(env, "read_file", { path: "/out/keep.txt" }), /precious/);
});

test("multi-line JSDoc descriptions land in the .d.ts as a block comment", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/doc.js",
    content: [
      `/**`,
      ` * First line of the description.`,
      ` * Second line with more detail.`,
      ` * @param {{ q: string }} args`,
      ` * @returns {Promise<string>}`,
      ` */`,
      `export default async function doc(args) { return args.q; }`,
    ].join("\n"),
  });
  const dts = await callOk(env, "read_file", { path: "/scripts/doc.d.ts" });
  assert.match(dts, /First line of the description\./);
  assert.match(dts, /Second line with more detail\./);
  assert.match(dts, /declare function doc\(args: \{ q: string \}\): Promise<string>;/);
});

test("destructured params without JSDoc produce optional-aware any types", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/dest.js",
    content: `export default async function dest({ input, format = "a4" }) { return { input, format }; }\n`,
  });
  const dts = await callOk(env, "read_file", { path: "/scripts/dest.d.ts" });
  assert.match(dts, /declare function dest\(args: \{ input: any; format\?: any \}\): Promise<unknown>;/);
});

test("dotted @param tags build the args object type", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/dotted.js",
    content: [
      `/**`,
      ` * Formats a report.`,
      ` * @param {Object} args`,
      ` * @param {string} args.input`,
      ` * @param {string} [args.format]`,
      ` * @returns {Promise<{ output: string }>}`,
      ` */`,
      `export default async function report(args) { return { output: args.input + (args.format ?? "") }; }`,
    ].join("\n"),
  });
  const dts = await callOk(env, "read_file", { path: "/scripts/dotted.d.ts" });
  assert.match(dts, /declare function report\(args: \{ input: string; format\?: string \}\): Promise<\{ output: string \}>;/);
});

// ============================== destructuring exports, checked against Node

/**
 * Run the same module through REAL Node ESM and through the environment, and
 * compare the namespaces.
 *
 * The tests above compare against expectations written by hand, which encode
 * what the author believes ESM does. This encodes what it actually does — the
 * only useful standard for a transform whose job is to be indistinguishable
 * from the real thing.
 */
async function differential(src: string, keys: string[], label: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "glove-diff-"));
  let node: Record<string, unknown>;
  try {
    const file = join(dir, "mod.mjs");
    await writeFile(file, src);
    const real = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    node = Object.fromEntries(keys.map((k) => [k, real[k]]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/lib/mod.js", content: src });
  await callOk(env, "write_file", {
    path: "/scripts/probe.js",
    content:
      `import * as ns from './lib/mod.js';\n` +
      `export default async function probe(){ const o = {}; for (const k of ${JSON.stringify(keys)}) o[k] = ns[k]; return o; }`,
  });
  const run = await env.runScript("/scripts/probe.js");
  assert.equal(run.ok, true, `${label}: the environment refused it — ${run.error}`);
  assert.deepEqual(run.result, node, `${label}: diverges from Node ESM`);
}

test("object destructuring exports match Node", async () => {
  await differential(
    `const summary = { region: 'emea', total: 42, nested: { deep: 7 }, other: 1 };\n` +
      `export const { region, total } = summary;\n`,
    ["region", "total"],
    "plain object pattern",
  );
  await differential(
    `const o = { a: 1, b: 2, c: 3 };\n` + `export const { a: renamed, b = 99, missing = 'fallback', ...rest } = o;\n`,
    ["renamed", "b", "missing", "rest"],
    "rename, defaults, rest",
  );
  await differential(
    `const o = { outer: { inner: 5 }, list: [1, 2] };\n` + `export const { outer: { inner }, list: [first, second] } = o;\n`,
    ["inner", "first", "second"],
    "nested patterns",
  );
  await differential(
    `const key = 'dyn';\nconst o = { dyn: 'computed value' };\n` + `export const { [key]: viaComputed } = o;\n`,
    ["viaComputed"],
    "computed key",
  );
});

test("array destructuring exports match Node", async () => {
  await differential(`const items = [1, 2, 3, 4];\nexport const [first, ...rest] = items;\n`, ["first", "rest"], "array with rest");
  await differential(
    `const items = ['a', 'b', 'c'];\nexport const [, second, , fourth = 'default'] = items;\n`,
    ["second", "fourth"],
    "holes and a default",
  );
  await differential(
    `const rows = [[1, 2], [3, 4]];\nexport const [[a, b], [c, d]] = rows;\n`,
    ["a", "b", "c", "d"],
    "nested array patterns",
  );
});

test("destructuring works in later declarator positions too", async () => {
  // The position the earlier scanner silently dropped, which is what made the
  // loud rejection the right first fix.
  await differential(
    `const o = { x: 1 };\nconst arr = [7, 8];\n` + `export const plain = 'p', { x } = o, [seven] = arr, last = 'l';\n`,
    ["plain", "x", "seven", "last"],
    "pattern after a plain declarator",
  );
  await differential(`const o = { y: 2 };\nexport let { y } = o, z = 3;\n`, ["y", "z"], "export let with a pattern first");
});

test("a destructured export is importable by name, not just through the namespace", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/lib/conf.js",
    content: `const raw = { host: 'example.test', port: 8080 };\nexport const { host, port } = raw;\n`,
  });
  await callOk(env, "write_file", {
    path: "/scripts/uses.js",
    content: `import { host, port } from './lib/conf.js';\nexport default async function uses(){ return host + ':' + port; }`,
  });
  const run = await env.runScript("/scripts/uses.js");
  assert.equal(run.result, "example.test:8080");
});

// ================================ live bindings: reported, never silent

test("a named import of a reassigned export is refused, with the fix", async () => {
  // Real ESM: `n` reads 1 after bump(). Here a named import copies the value
  // at import time, so it would read 0 — silently, which is the worst
  // possible shape for a semantics gap. Real live bindings need every
  // identifier reference rewritten, which needs a parser.
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/lib/counter.js",
    content: `export let n = 0;\nexport function bump() { n += 1; }\n`,
  });
  const refused = await callErr(env, "write_file", {
    path: "/scripts/named.js",
    content: `import { n, bump } from './lib/counter.js';\nexport default async function main(){ bump(); return n; }`,
  });
  assert.match(refused, /"n" is reassigned by \.\/lib\/counter\.js/);
  assert.match(refused, /import \* as ns from '\.\/lib\/counter\.js'/);
  assert.match(refused, /ns\.n/);

  // Importing the FUNCTION alone is fine — only the mutated binding diverges.
  await callOk(env, "write_file", {
    path: "/scripts/fnonly.js",
    content: `import { bump } from './lib/counter.js';\nexport default async function main(){ bump(); return 'ok'; }`,
  });
});

test("the namespace form is live, and matches Node", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/lib/counter.js",
    content: `export let n = 0;\nexport function bump() { n += 1; }\n`,
  });
  await callOk(env, "write_file", {
    path: "/scripts/ns.js",
    content: `import * as counter from './lib/counter.js';\nexport default async function main(){ counter.bump(); counter.bump(); return counter.n; }`,
  });
  const run = await env.runScript("/scripts/ns.js");
  assert.equal(run.result, 2, "the namespace must track the mutation, as real ESM does");
});

test("an export let that is never reassigned imports by name as usual", async () => {
  // Refusing every `export let` would cost a retry for code that cannot
  // diverge — only a binding actually written to later can.
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/lib/settings.js",
    content: `export let retries = 3;\nexport let label = 'default';\nconst note = 'retries = 99 is only text';\nexport function describe() { return note; }\n`,
  });
  await callOk(env, "write_file", {
    path: "/scripts/reads.js",
    content: `import { retries, label } from './lib/settings.js';\nexport default async function main(){ return retries + ':' + label; }`,
  });
  assert.equal((await env.runScript("/scripts/reads.js")).result, "3:default");
});

test("reassignment detection ignores comparisons, arrows, and property writes", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/lib/lookalikes.js",
    content: [
      `export let value = 1;`,
      `const holder = { value: 0 };`,
      `export function check(v) {`,
      `  if (value === v) return 'eq';`,
      `  if (value >= v) return 'ge';`,
      `  holder.value = v;`,          // property write, not the binding
      `  const f = (value) => value;`, // shadowing parameter
      `  return f(value);`,
      `}`,
    ].join("\n"),
  });
  await callOk(env, "write_file", {
    path: "/scripts/uses_lookalikes.js",
    content: `import { value, check } from './lib/lookalikes.js';\nexport default async function main(){ return [value, check(1)]; }`,
  });
  assert.deepEqual((await env.runScript("/scripts/uses_lookalikes.js")).result, [1, "eq"]);
});

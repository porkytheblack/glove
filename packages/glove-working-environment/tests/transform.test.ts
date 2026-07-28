/**
 * Unit tests for the ESM transform + the executor's handling of trickier
 * module shapes (strings/comments/regexes containing keywords, export
 * variants, .js-less specifiers).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { transformModule, TransformError } from "../src/executor/transform";
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

test("destructuring exports fail with a clear message", () => {
  assert.throws(
    () => transformModule(`export const { a } = { a: 1 };\nexport default async () => a;`, "/scripts/x.js"),
    (e: unknown) => e instanceof TransformError && /destructuring exports are not supported/.test((e as Error).message),
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

/**
 * Acceptance: writing a valid script produces the file + correct sibling
 * .d.ts; invalid scripts fail the write with the specified error messages;
 * every verb keeps derived state consistent; /std and /.env are read-only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { call, callErr, callOk, makeEnv, VALID_SCRIPT } from "./helpers";

test("valid script write produces sibling .d.ts with JSDoc types", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  const dts = await callOk(env, "read_file", { path: "/scripts/add.d.ts" });
  assert.match(dts, /Adds two numbers from args\./);
  assert.match(dts, /declare function addNumbers\(args: \{ a: number, b: number \}\): Promise<\{ sum: number \}>;/);
  assert.match(dts, /export default addNumbers;/);
});

test("script with named exports but no default fails with the guardrail message", async () => {
  const env = await makeEnv();
  const msg = await callErr(env, "write_file", {
    path: "/scripts/parse.js",
    content: `export function parse(x) { return x; }\nexport function format(x) { return x; }\n`,
  });
  assert.equal(
    msg,
    'script exports { parse, format } but no default. Add "export default parse" or wrap in a default function. Scripts must export default async function(args) { ... }',
  );
  assert.equal(await call(env, "read_file", { path: "/scripts/parse.js" }).then((r) => r.status), "error"); // write failed — file absent
});

test("program-style script with no exports fails with the guardrail message", async () => {
  const env = await makeEnv();
  const msg = await callErr(env, "write_file", {
    path: "/scripts/top.js",
    content: `const x = 1;\nconsole.log(x);\n`,
  });
  assert.equal(
    msg,
    "script has no default export. Scripts must export default async function(args) { ... } — top-level program-style scripts are not supported.",
  );
});

test("non-function default export fails, naming the type", async () => {
  const env = await makeEnv();
  const msg = await callErr(env, "write_file", { path: "/scripts/obj.js", content: `export default { a: 1 };\n` });
  assert.equal(msg, "default export is a object; expected a function of shape async (args) => result.");
  const msg2 = await callErr(env, "write_file", { path: "/scripts/str.js", content: `export default "hello";\n` });
  assert.equal(msg2, "default export is a string; expected a function of shape async (args) => result.");
});

test("syntax errors fail the write with the path", async () => {
  const env = await makeEnv();
  const msg = await callErr(env, "write_file", { path: "/scripts/bad.js", content: `export default async function (args) {\n  return {;\n}\n` });
  assert.match(msg, /\/scripts\/bad\.js/);
});

test("missing JSDoc accepts the write but appends the soft nudge", async () => {
  const env = await makeEnv();
  const msg = await callOk(env, "write_file", {
    path: "/scripts/plain.js",
    content: `export default async function plain(args) { return args; }\n`,
  });
  assert.match(msg, /saved; add a JSDoc block above the default export to get typed, described \.d\.ts output\./);
  // .d.ts still generated, with any-typed args
  const dts = await callOk(env, "read_file", { path: "/scripts/plain.d.ts" });
  assert.match(dts, /declare function plain\(args: any\): Promise<unknown>;/);
});

test("edit_file re-runs the pipeline: invalid edit fails and leaves the script untouched", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  const msg = await callErr(env, "edit_file", {
    path: "/scripts/add.js",
    old_str: "export default async function addNumbers(args)",
    new_str: "async function addNumbers(args)",
  });
  assert.match(msg, /no default export/);
  const body = await callOk(env, "read_file", { path: "/scripts/add.js" });
  assert.match(body, /export default async function addNumbers/);
});

test("edit_file updates the .d.ts when the signature changes", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  await callOk(env, "edit_file", {
    path: "/scripts/add.js",
    old_str: "async function addNumbers(args)",
    new_str: "async function addAll(args)",
  });
  const dts = await callOk(env, "read_file", { path: "/scripts/add.d.ts" });
  assert.match(dts, /declare function addAll/);
});

test("mv moves the sibling .d.ts; cp regenerates at the destination; rm removes both", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });

  await callOk(env, "mv", { from: "/scripts/add.js", to: "/scripts/sum.js" });
  assert.match(await callErr(env, "read_file", { path: "/scripts/add.d.ts" }), /no such file/);
  assert.match(await callOk(env, "read_file", { path: "/scripts/sum.d.ts" }), /addNumbers/);

  await callOk(env, "cp", { from: "/scripts/sum.js", to: "/scripts/sum2.js" });
  assert.match(await callOk(env, "read_file", { path: "/scripts/sum2.d.ts" }), /addNumbers/);

  await callOk(env, "rm", { path: "/scripts/sum2.js" });
  assert.match(await callErr(env, "read_file", { path: "/scripts/sum2.d.ts" }), /no such file/);
  assert.match(await callErr(env, "read_file", { path: "/scripts/sum2.js" }), /no such file/);
});

test("moving a script out of /scripts drops its .d.ts; moving an invalid file in fails", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  await callOk(env, "mv", { from: "/scripts/add.js", to: "/tmp/add.js" });
  assert.match(await callErr(env, "read_file", { path: "/scripts/add.d.ts" }), /no such file/);

  await callOk(env, "write_file", { path: "/tmp/prog.js", content: `console.log("hi");\n` }); // fine outside /scripts
  const msg = await callErr(env, "mv", { from: "/tmp/prog.js", to: "/scripts/prog.js" });
  assert.match(msg, /no default export/);
  assert.equal((await call(env, "read_file", { path: "/tmp/prog.js" })).status, "success"); // unmoved
});

test("direct mutation of a generated .d.ts is rejected; so are /std, /.env, and .ts under /scripts", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  assert.match(await callErr(env, "write_file", { path: "/scripts/add.d.ts", content: "x" }), /derived from their sibling scripts/);
  assert.match(await callErr(env, "edit_file", { path: "/scripts/add.d.ts", old_str: "a", new_str: "b" }), /derived/);
  assert.match(await callErr(env, "rm", { path: "/scripts/add.d.ts" }), /derived/);
  assert.match(await callErr(env, "write_file", { path: "/std/fs/index.d.ts", content: "x" }), /read-only/);
  assert.match(await callErr(env, "rm", { path: "/std" }), /read-only/);
  assert.match(await callErr(env, "write_file", { path: "/.env/history.jsonl", content: "x" }), /read-only/);
  assert.match(await callErr(env, "rm", { path: "/.env/history.jsonl" }), /read-only/);
  assert.match(await callErr(env, "write_file", { path: "/scripts/x.ts", content: "export default 1" }), /TypeScript sources are not executable/);
  // …but reads of /std and /.env are fine
  assert.match(await callOk(env, "read_file", { path: "/std/fs/index.d.ts" }), /readFile/);
});

test("utility modules under /scripts/lib may use named exports (no default required)", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/lib/util.js",
    content: `export function double(n) { return n * 2; }\n`,
  });
  await callOk(env, "write_file", {
    path: "/scripts/use.js",
    content: `import { double } from './lib/util.js';\nexport default async function use(args) { return double(args.n); }\n`,
  });
  const out = await env.runScript("/scripts/use.js", { n: 21 });
  assert.equal(out.result, 42);
  // …but a lib module with broken syntax still fails the write
  const msg = await callErr(env, "write_file", { path: "/scripts/lib/broken.js", content: "function {" });
  assert.match(msg, /syntax error/);
});

test("run_script enforces the contract for scripts outside /scripts too", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/tmp/prog.js", content: `export const x = 1;\n` });
  const r = await call(env, "run_script", { path: "/tmp/prog.js" });
  assert.equal(r.status, "error");
  assert.match(String(r.message), /but no default/);
});

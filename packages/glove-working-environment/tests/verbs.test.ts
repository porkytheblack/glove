/**
 * The reading/discovery verbs and the context-window discipline:
 * read_file slicing, ls as capability catalog, grep, run_script spillover,
 * history (runs + file versions), edit_file exact-once semantics.
 */
/*
 * The three tests at the bottom of this file pin failures that agent
 * evaluation (benches/working-environment-bench) showed were the dominant
 * source of wasted turns — not crashes, but messages that sent models the
 * wrong way. They are regression tests for wording as much as behaviour.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { call, callErr, callOk, makeEnv, VALID_SCRIPT } from "./helpers";

test("read_file numbers lines and slices with start_line/end_line", async () => {
  const env = await makeEnv();
  const content = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
  await callOk(env, "write_file", { path: "/tmp/notes.txt", content });
  const out = await callOk(env, "read_file", { path: "/tmp/notes.txt", start_line: 10, end_line: 12 });
  assert.match(out, /showing lines 10–12 of 50/);
  assert.match(out, /10\tline 10/);
  assert.match(out, /12\tline 12/);
  assert.doesNotMatch(out, /line 13/);
});

test("read_file caps output at the response line limit with an explicit tail", async () => {
  const env = await makeEnv({ limits: { maxToolResponseLines: 20 } });
  const content = Array.from({ length: 100 }, (_, i) => `row ${i + 1}`).join("\n");
  await callOk(env, "write_file", { path: "/tmp/big.txt", content });
  const out = await callOk(env, "read_file", { path: "/tmp/big.txt" });
  assert.match(out, /showing lines 1–20 of 100/);
  assert.match(out, /… \[80 more lines — slice with start_line=21\]/);
});

test("read_file refuses binary and points at adapter describe()", async () => {
  const env = await makeEnv();
  await env.mount(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02]), "/inbox/blob.pdf");
  const msg = await callErr(env, "read_file", { path: "/inbox/blob.pdf" });
  assert.match(msg, /binary file/);
  assert.match(msg, /describe\(\)/);
});

test("ls /scripts inlines one-line JSDoc descriptions — the capability catalog", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  await callOk(env, "write_file", {
    path: "/scripts/greet.js",
    content: `/**\n * Greets a person by name.\n * More detail that should not appear in ls.\n */\nexport default async function greet(args) { return "hi " + args.name; }\n`,
  });
  const out = await callOk(env, "ls", { path: "/scripts" });
  assert.match(out, /add\.js \(\d+B\) — Adds two numbers from args\./);
  assert.match(out, /greet\.js \(\d+B\) — Greets a person by name\./);
  assert.doesNotMatch(out, /More detail/);
  assert.match(out, /lib\//);
});

test("ls /std lists adapter descriptions and depth recurses", async () => {
  const env = await makeEnv();
  const out = await callOk(env, "ls", { path: "/std" });
  assert.match(out, /fs\/ — VFS-scoped file I\/O/);
  assert.match(out, /std\/ — Zero-dep battery/);
  const deep = await callOk(env, "ls", { path: "/std", depth: 2 });
  assert.match(deep, /index\.d\.ts/);
});

test("grep finds content across the tree, honors glob and context, and caps matches", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/invoices.js", content: `/** Handles invoice parsing. */\nexport default async function invoices() { return "invoice"; }\n` });
  await callOk(env, "write_file", { path: "/tmp/log.txt", content: "an invoice arrived\nnothing here\nanother invoice line\n" });

  const out = await callOk(env, "grep", { pattern: "invoice", path: "/" });
  assert.match(out, /\/scripts\/invoices\.js:\d+:/);
  assert.match(out, /\/tmp\/log\.txt:1: an invoice arrived/);

  const scoped = await callOk(env, "grep", { pattern: "invoice", path: "/", glob: "/tmp/**" });
  assert.doesNotMatch(scoped, /invoices\.js/);

  const ctx = await callOk(env, "grep", { pattern: "another", path: "/tmp/log.txt", context: 1 });
  assert.match(ctx, /\/tmp\/log\.txt:2- nothing here/);
  assert.match(ctx, /\/tmp\/log\.txt:3: another invoice line/);

  const capped = await callOk(env, "grep", { pattern: "invoice", path: "/", max_matches: 1 });
  assert.match(capped, /capped at max_matches=1/);

  assert.match(await callErr(env, "grep", { pattern: "([" }), /invalid regex/);
});

test("oversized run_script output is truncated and spilled to /tmp, and the tail names the file", async () => {
  const env = await makeEnv({ limits: { maxToolResponseLines: 30, maxToolResponseBytes: 2000 } });
  await callOk(env, "write_file", {
    path: "/scripts/bulk.js",
    content: `export default async function bulk() { return Array.from({ length: 500 }, (_, i) => ({ row: i, label: "item " + i })); }\n`,
  });
  const out = await callOk(env, "run_script", { path: "/scripts/bulk.js" });
  assert.match(out, /more lines — written to \/tmp\/run-[a-z0-9_]+\.out\]/);
  const spillPath = /written to (\/tmp\/run-[a-z0-9_]+\.out)\]/.exec(out)![1];
  const spilled = await callOk(env, "read_file", { path: spillPath, start_line: 1, end_line: 5 });
  assert.match(spilled, /"row": 0/);
  // and the run history records the spill
  const hist = await callOk(env, "history", {});
  assert.match(hist, new RegExp(`spill=${spillPath.replace(/[/.]/g, "\\$&")}`));
});

test("history without a path lists recent runs; with a path lists file versions", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  await callOk(env, "run_script", { path: "/scripts/add.js", args: { a: 1, b: 2 } });
  await callOk(env, "write_file", { path: "/scripts/boom.js", content: `export default async function boom() { throw new Error("nope"); }\n` });
  const failing = await call(env, "run_script", { path: "/scripts/boom.js" });
  assert.equal(failing.status, "error");

  const runs = await callOk(env, "history", {});
  assert.match(runs, /ok\s+\d+ms\s+\/scripts\/add\.js args=\{"a":1,"b":2\}/);
  assert.match(runs, /FAIL \d+ms\s+\/scripts\/boom\.js/);

  await callOk(env, "edit_file", { path: "/scripts/add.js", old_str: "args.a + args.b", new_str: "args.b + args.a" });
  const versions = await callOk(env, "history", { path: "/scripts/add.js" });
  assert.match(versions, /\/scripts\/add\.js: 2 version\(s\) behind, 0 ahead/);
  assert.match(versions, /write/);
  assert.match(versions, /edit/);
});

test("history.jsonl itself is grepable (self-debugging)", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  await callOk(env, "run_script", { path: "/scripts/add.js", args: { a: 1, b: 1 } });
  const out = await callOk(env, "grep", { pattern: "add\\.js", path: "/.env/history.jsonl" });
  assert.match(out, /history\.jsonl:1:/);
});

test("edit_file demands exactly one match and reports the count", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/tmp/t.txt", content: "aaa bbb aaa" });
  assert.match(await callErr(env, "edit_file", { path: "/tmp/t.txt", old_str: "zzz", new_str: "x" }), /0 matches/);
  assert.match(await callErr(env, "edit_file", { path: "/tmp/t.txt", old_str: "aaa", new_str: "x" }), /matches 2 times/);
  await callOk(env, "edit_file", { path: "/tmp/t.txt", old_str: "bbb", new_str: "ccc" });
  assert.match(await callOk(env, "read_file", { path: "/tmp/t.txt" }), /aaa ccc aaa/);
});

test("write_file auto-creates parent directories (no mkdir verb needed)", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/tmp/deep/nested/dir/file.txt", content: "hi" });
  assert.match(await callOk(env, "ls", { path: "/tmp/deep/nested/dir" }), /file\.txt/);
});

test("write_file append mode appends", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/tmp/log.txt", content: "one\n" });
  await callOk(env, "write_file", { path: "/tmp/log.txt", content: "two\n", append: true });
  assert.match(await callOk(env, "read_file", { path: "/tmp/log.txt" }), /1\tone\n\s*2\ttwo/);
});

test("rm on a directory removes recursively and reports the count", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/tmp/a/x.txt", content: "x" });
  await callOk(env, "write_file", { path: "/tmp/a/b/y.txt", content: "y" });
  const out = await callOk(env, "rm", { path: "/tmp/a" });
  assert.match(out, /removed 2 files under \/tmp\/a/);
  assert.match(await callErr(env, "read_file", { path: "/tmp/a/x.txt" }), /no such file/);
});

test("mv of a directory moves scripts with cross-imports intact", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/pipeline/lower.js", content: `export default async function lower(args) { return args.s.toLowerCase(); }\n` });
  await callOk(env, "write_file", {
    path: "/scripts/pipeline/main.js",
    content: `import lower from './lower.js';\nexport default async function main(args) { return lower({ s: args.s }); }\n`,
  });
  await callOk(env, "mv", { from: "/scripts/pipeline", to: "/scripts/text" });
  const run = await env.runScript("/scripts/text/main.js", { s: "ABC" });
  assert.equal(run.result, "abc");
  // old .d.ts gone, new ones exist
  assert.match(await callErr(env, "read_file", { path: "/scripts/pipeline/main.d.ts" }), /no such/);
  assert.match(await callOk(env, "read_file", { path: "/scripts/text/main.d.ts" }), /declare function main/);
});

// ─────────────────────────── friction found by agent evaluation

test("running a script that does not exist says so, and lists what does", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/real.js", content: VALID_SCRIPT });

  // Previously: "no such module: /scripts/missing.js" — the import
  // resolver's error, which reads as a dependency problem rather than
  // "you have not written this yet".
  const err = await callErr(env, "run_script", { path: "/scripts/missing.js" });
  assert.match(err, /no such script: \/scripts\/missing\.js/);
  assert.match(err, /\/scripts\/real\.js/, "should name the scripts that do exist");
  assert.doesNotMatch(err, /no such module/);
});

test("running an empty script library says the library is empty", async () => {
  const env = await makeEnv();
  const err = await callErr(env, "run_script", { path: "/scripts/nothing.js" });
  assert.match(err, /\/scripts is empty/);
  assert.match(err, /write_file/);
});

test("running or importing something under /std points at the module name", async () => {
  const env = await makeEnv();

  // Models read /std/<name>/index.d.ts and then try to run or import that
  // path. Running it used to parse a .d.ts as a module and report
  // "could not parse export statement".
  const ran = await callErr(env, "run_script", { path: "/std/std/index.d.ts" });
  assert.match(ran, /^Write a script under \/scripts/, "the fix belongs in the first clause, not the last");
  assert.match(ran, /from 'env:std'/);
  assert.doesNotMatch(ran, /could not parse/);

  // Importing a /std path is caught at WRITE time — validation loads the
  // module, so the model is corrected before the script is ever stored.
  const imported = await callErr(env, "write_file", {
    path: "/scripts/importsdocs.js",
    content: `import { json } from '/std/std';\n\n/** Nope. */\nexport default async function main() { return json; }\n`,
  });
  assert.match(imported, /\/std holds documentation, not modules/);
  assert.match(imported, /from 'env:std'/);
  assert.equal(await env.fs.exists("/scripts/importsdocs.js"), false, "a rejected write leaves nothing behind");
});

test("a directory or a non-.js target is refused in its own terms", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/dir/inner.js", content: VALID_SCRIPT });
  assert.match(await callErr(env, "run_script", { path: "/scripts/dir" }), /is a directory, not a script/);

  await callOk(env, "write_file", { path: "/tmp/data.json", content: "{}" });
  assert.match(await callErr(env, "run_script", { path: "/tmp/data.json" }), /not a \.js file/);
});

test("env:fs types warn that readdir yields entries, not strings", async () => {
  // `entries.filter(f => f.endsWith('.png'))` was the most common in-script
  // mistake: Node's fs.readdir returns strings, ours returns objects.
  const env = await makeEnv();
  const types = await env.fs.readFile("/std/fs/index.d.ts");
  assert.match(types, /ENTRY OBJECTS, not strings/);
  assert.match(types, /endsWith/, "the doc should name the exact slip");
  assert.match(types, /glob\(\)/, "and point at the function that returns paths");
});

test("a repeated identical failure escalates instead of repeating itself", async () => {
  // A model that stops reading and starts retrying cannot be reached by
  // better prose — one did exactly this three times against a message
  // naming the exact fix. So the environment stops answering identically.
  const env = await makeEnv();
  const call1 = await callErr(env, "run_script", { path: "/std/std/index.d.ts" });
  const call2 = await callErr(env, "run_script", { path: "/std/std/index.d.ts" });
  const call3 = await callErr(env, "run_script", { path: "/std/std/index.d.ts" });

  assert.doesNotMatch(call1, /Second time|STOP/, "the first answer is just the answer");
  assert.match(call2, /Second time this exact call/);
  assert.match(call3, /^STOP: this call has failed 3 times/);
  assert.match(call3, /ls or read_file/, "and says what to do instead");
  // The original answer survives underneath — escalation adds urgency, it
  // does not withhold the explanation.
  assert.match(call3, /from 'env:std'/);
});

test("escalation keys on the call, not the verb — different args start over", async () => {
  const env = await makeEnv();
  await callErr(env, "run_script", { path: "/scripts/a.js" });
  await callErr(env, "run_script", { path: "/scripts/a.js" });
  const other = await callErr(env, "run_script", { path: "/scripts/b.js" });
  assert.doesNotMatch(other, /Second time|STOP/, "a different path is a different call");

  // Argument order must not defeat the match: {path, args} and {args, path}
  // are the same call.
  await callErr(env, "grep", { pattern: "[", path: "/" });
  const flipped = await callErr(env, "grep", { path: "/", pattern: "[" });
  assert.match(flipped, /Second time this exact call/);
});

test("escalation does not fire on success, however repetitive", async () => {
  const env = await makeEnv();
  for (let i = 0; i < 4; i++) {
    const out = await callOk(env, "ls", { path: "/" });
    assert.doesNotMatch(out, /STOP|Second time/);
  }
});

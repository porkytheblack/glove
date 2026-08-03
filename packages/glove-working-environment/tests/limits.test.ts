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
  const env = await makeEnv({ limits: { maxVfsBytes: 12_000 } });
  // each write stores the prior content as a version blob; the cap counts both
  await callOk(env, "write_file", { path: "/tmp/t.txt", content: "a".repeat(4_000) });
  const msg = await callErr(env, "write_file", { path: "/tmp/t.txt", content: "b".repeat(8_000) });
  assert.match(msg, /limits\.maxVfsBytes/);
});

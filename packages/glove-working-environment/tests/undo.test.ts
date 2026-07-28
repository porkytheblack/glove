/**
 * Acceptance: undo/redo behave as linear per-file undo, including for rm,
 * and re-run the pipeline for scripts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { callErr, callOk, makeEnv, VALID_SCRIPT } from "./helpers";

test("undo reverts an edit; redo walks forward again", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/tmp/t.txt", content: "v1" });
  await callOk(env, "write_file", { path: "/tmp/t.txt", content: "v2" });
  await callOk(env, "edit_file", { path: "/tmp/t.txt", old_str: "v2", new_str: "v3" });

  await callOk(env, "undo", { path: "/tmp/t.txt" });
  assert.match(await callOk(env, "read_file", { path: "/tmp/t.txt" }), /v2/);
  await callOk(env, "undo", { path: "/tmp/t.txt" });
  assert.match(await callOk(env, "read_file", { path: "/tmp/t.txt" }), /v1/);
  await callOk(env, "redo", { path: "/tmp/t.txt" });
  assert.match(await callOk(env, "read_file", { path: "/tmp/t.txt" }), /v2/);
  await callOk(env, "redo", { path: "/tmp/t.txt" });
  assert.match(await callOk(env, "read_file", { path: "/tmp/t.txt" }), /v3/);
  assert.match(await callErr(env, "redo", { path: "/tmp/t.txt" }), /nothing to redo/);
});

test("a fresh mutation after undo truncates the redo branch (linear model)", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/tmp/t.txt", content: "v1" });
  await callOk(env, "write_file", { path: "/tmp/t.txt", content: "v2" });
  await callOk(env, "undo", { path: "/tmp/t.txt" });
  await callOk(env, "write_file", { path: "/tmp/t.txt", content: "v1b" });
  assert.match(await callErr(env, "redo", { path: "/tmp/t.txt" }), /nothing to redo/);
});

test("undo of a creation removes the file; undo of rm restores it (with its .d.ts)", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  await callOk(env, "rm", { path: "/scripts/add.js" });
  assert.match(await callErr(env, "read_file", { path: "/scripts/add.d.ts" }), /no such file/);

  const restored = await callOk(env, "undo", { path: "/scripts/add.js" });
  assert.match(restored, /file restored/);
  assert.match(await callOk(env, "read_file", { path: "/scripts/add.js" }), /addNumbers/);
  assert.match(await callOk(env, "read_file", { path: "/scripts/add.d.ts" }), /declare function addNumbers/);

  await callOk(env, "undo", { path: "/scripts/add.js" }); // back past rm → before creation
  assert.match(await callErr(env, "read_file", { path: "/scripts/add.js" }), /no such file/);
  assert.match(await callErr(env, "read_file", { path: "/scripts/add.d.ts" }), /no such file/);
});

test("undoing a script edit regenerates the matching .d.ts", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  await callOk(env, "edit_file", { path: "/scripts/add.js", old_str: "addNumbers", new_str: "addBoth" });
  assert.match(await callOk(env, "read_file", { path: "/scripts/add.d.ts" }), /addBoth/);
  await callOk(env, "undo", { path: "/scripts/add.js" });
  assert.match(await callOk(env, "read_file", { path: "/scripts/add.d.ts" }), /addNumbers/);
});

test("undo is per-file: rm of a directory is undoable file by file", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/tmp/a/x.txt", content: "x" });
  await callOk(env, "write_file", { path: "/tmp/a/y.txt", content: "y" });
  await callOk(env, "rm", { path: "/tmp/a" });
  await callOk(env, "undo", { path: "/tmp/a/x.txt" });
  assert.match(await callOk(env, "read_file", { path: "/tmp/a/x.txt" }), /x/);
  assert.match(await callErr(env, "read_file", { path: "/tmp/a/y.txt" }), /no such file/);
});

test("undo on a derived .d.ts or /.env path is rejected; nothing-to-undo is a clear error", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  assert.match(await callErr(env, "undo", { path: "/scripts/add.d.ts" }), /derived/);
  assert.match(await callErr(env, "undo", { path: "/.env/history.jsonl" }), /read-only/);
  assert.match(await callErr(env, "undo", { path: "/tmp/never-written.txt" }), /nothing to undo/);
});

test("version ring keeps only the last N versions", async () => {
  const env = await makeEnv({ limits: { maxVersionsPerFile: 2 } });
  for (const v of ["v1", "v2", "v3", "v4"]) {
    await callOk(env, "write_file", { path: "/tmp/t.txt", content: v });
  }
  await callOk(env, "undo", { path: "/tmp/t.txt" }); // → v3
  await callOk(env, "undo", { path: "/tmp/t.txt" }); // → v2
  assert.match(await callErr(env, "undo", { path: "/tmp/t.txt" }), /nothing to undo/); // v1 evicted
  assert.match(await callOk(env, "read_file", { path: "/tmp/t.txt" }), /v2/);
});

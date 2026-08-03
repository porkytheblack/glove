/**
 * Acceptance: undo/redo behave as linear per-file undo, including for rm,
 * and re-run the pipeline for scripts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkingEnvironment, fromSnapshot } from "../src/index";
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

// ─────────────────────────────── whole-tree checkpoints (what undo cannot do)

test("a checkpoint puts back everything, including files created since", async () => {
  // The case undo cannot reach: a restructure across several files, where
  // "put it back" has to mean the new file is gone, not merely that the
  // edited ones are reverted.
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/pipeline.js", content: VALID_SCRIPT });
  await callOk(env, "write_file", { path: "/out/report.txt", content: "original" });

  await callOk(env, "checkpoint", { action: "fork", name: "before-refactor" });

  // A mess across several files.
  await callOk(env, "edit_file", { path: "/out/report.txt", old_str: "original", new_str: "mangled" });
  await callOk(env, "write_file", { path: "/scripts/lib/helper.js", content: `export const k = 1;\n` });
  await callOk(env, "write_file", { path: "/out/extra.txt", content: "should not survive" });
  await callOk(env, "rm", { path: "/scripts/pipeline.js" });

  const restored = await callOk(env, "checkpoint", { action: "restore", name: "before-refactor" });
  assert.match(restored, /restored "before-refactor"/);

  assert.equal(await env.fs.readFile("/out/report.txt"), "original");
  assert.equal(await env.fs.exists("/scripts/pipeline.js"), true, "a deleted file comes back");
  assert.equal(await env.fs.exists("/out/extra.txt"), false, "a file created since is removed");
  assert.equal(await env.fs.exists("/scripts/lib/helper.js"), false);
  // And the restored script still runs — the .d.ts came back with it.
  assert.equal(await env.fs.exists("/scripts/pipeline.d.ts"), true);
  assert.equal((await env.runScript("/scripts/pipeline.js", { a: 2, b: 3 })).ok, true);
});

test("run history survives a restore — it records what actually ran", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  await callOk(env, "checkpoint", { action: "fork", name: "start" });
  await callOk(env, "run_script", { path: "/scripts/add.js", args: { a: 1, b: 2 } });
  await callOk(env, "checkpoint", { action: "restore", name: "start" });

  const hist = await callOk(env, "history", {});
  assert.match(hist, /\/scripts\/add\.js/, "restoring files must not un-run a script");
});

test("checkpoints can be listed, dropped, and moved between", async () => {
  const env = await makeEnv();
  assert.match(await callOk(env, "checkpoint", {}), /no checkpoints yet/);

  await env.fs.writeFile("/out/x.txt", "A");
  await callOk(env, "checkpoint", { action: "fork", name: "state-a" });
  await env.fs.writeFile("/out/x.txt", "B");
  await callOk(env, "checkpoint", { action: "fork", name: "state-b" });

  const listed = await callOk(env, "checkpoint", { action: "list" });
  assert.match(listed, /state-a/);
  assert.match(listed, /state-b/);

  // Moving between two saved states, which is the branching case.
  await callOk(env, "checkpoint", { action: "restore", name: "state-a" });
  assert.equal(await env.fs.readFile("/out/x.txt"), "A");
  await callOk(env, "checkpoint", { action: "restore", name: "state-b" });
  assert.equal(await env.fs.readFile("/out/x.txt"), "B");

  await callOk(env, "checkpoint", { action: "drop", name: "state-a" });
  assert.doesNotMatch(await callOk(env, "checkpoint", { action: "list" }), /state-a/);
  assert.match(await callErr(env, "checkpoint", { action: "restore", name: "state-a" }), /no checkpoint named "state-a"/);
});

test("a checkpoint never contains the checkpoints", async () => {
  // Otherwise each fork embeds every earlier one and the tree grows
  // geometrically.
  const env = await makeEnv();
  await env.fs.writeFile("/out/x.txt", "x".repeat(500));
  await callOk(env, "checkpoint", { action: "fork", name: "one" });
  await callOk(env, "checkpoint", { action: "fork", name: "two" });
  await callOk(env, "checkpoint", { action: "fork", name: "three" });

  const sizes = await Promise.all(
    ["one", "two", "three"].map(async (n) => (await env.fs.stat(`/.env/branches/${n}.json`))!.size),
  );
  assert.ok(Math.max(...sizes) < Math.min(...sizes) * 1.5, `checkpoints should stay comparable in size, got ${sizes}`);
  // And restoring does not resurrect a dropped checkpoint.
  await callOk(env, "checkpoint", { action: "restore", name: "one" });
  assert.match(await callOk(env, "checkpoint", { action: "list" }), /three/);
});

test("checkpoint names are validated, and a missing one lists what exists", async () => {
  const env = await makeEnv();
  await callOk(env, "checkpoint", { action: "fork", name: "good-name_1" });
  assert.match(await callErr(env, "checkpoint", { action: "fork", name: "../escape" }), /invalid checkpoint name/);
  assert.match(await callErr(env, "checkpoint", { action: "fork", name: "" }), /invalid checkpoint name/);
  assert.match(await callErr(env, "checkpoint", { action: "restore", name: "nope" }), /Existing: good-name_1/);
  assert.match(await callErr(env, "checkpoint", { action: "sideways", name: "x" }), /unknown checkpoint action/);
});

test("checkpoints survive a host snapshot", async () => {
  const env = await makeEnv();
  await env.fs.writeFile("/out/x.txt", "before");
  await callOk(env, "checkpoint", { action: "fork", name: "saved" });
  await env.fs.writeFile("/out/x.txt", "after");

  const restored = await createWorkingEnvironment({ filesystem: fromSnapshot(JSON.parse(JSON.stringify(await env.snapshot()))) });
  assert.match(await callOk(restored, "checkpoint", { action: "list" }), /saved/);
  await callOk(restored, "checkpoint", { action: "restore", name: "saved" });
  assert.equal(await restored.fs.readFile("/out/x.txt"), "before");
});

/**
 * The small things a model reaches for and does not find.
 *
 * Each of these was observed as a wasted call rather than reasoned about: a
 * base64 `write_file`, an `rm` with a wildcard, a question about how long a
 * render may run, a script called with the wrong argument keys. None is a
 * defect on its own; together they are most of the friction in a session.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkingEnvironment } from "../src/index";
import { call, callOk, script } from "./helpers";

test("write_file writes real bytes from base64", async () => {
  const env = await createWorkingEnvironment({});
  try {
    // A one-pixel PNG: binary, with a magic number worth checking.
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await callOk(env, "write_file", { path: "/out/dot.png", content: png, encoding: "base64" });

    const bytes = await env.fs.readBytes("/out/dot.png");
    assert.deepEqual([...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "not a PNG header");
    assert.equal(bytes.byteLength, Buffer.from(png, "base64").byteLength);

    // Without the flag the same string is stored as text, which is the old
    // behaviour and must not change.
    await callOk(env, "write_file", { path: "/out/as-text.txt", content: png });
    assert.equal(await env.fs.readFile("/out/as-text.txt"), png);
  } finally {
    await env.close({ graceMs: 100 });
  }
});

test("malformed base64 is refused rather than half-decoded", async () => {
  // Node decodes what it can and drops the rest, which writes a corrupt file
  // that only fails later, inside whatever tries to read it.
  const env = await createWorkingEnvironment({});
  try {
    const bad = await call(env, "write_file", { path: "/out/x.bin", content: "not!valid!base64", encoding: "base64" });
    assert.equal(bad.status, "error");
    assert.match(String(bad.message), /not valid base64/);
    assert.equal(await env.fs.exists("/out/x.bin"), false, "a corrupt file was written anyway");

    const wrongEncoding = await call(env, "write_file", { path: "/out/y.txt", content: "hi", encoding: "hex" });
    assert.equal(wrongEncoding.status, "error");
    assert.match(String(wrongEncoding.message), /utf8.*base64/);
  } finally {
    await env.close({ graceMs: 100 });
  }
});

test("a wildcard path in rm/mv/cp returns the script recipe, not 'no such file'", async () => {
  const env = await createWorkingEnvironment({});
  try {
    await env.fs.writeFile("/tmp/a.png", "x");
    await env.fs.writeFile("/tmp/b.png", "x");

    const removed = await call(env, "rm", { path: "/tmp/*.png" });
    assert.equal(removed.status, "error");
    assert.match(String(removed.message), /takes one path, not a pattern/);
    assert.match(String(removed.message), /fs\.glob\('\/tmp\/\*\.png'\)/, "the recipe does not use the path that was asked for");
    // The files are still there — the refusal did nothing.
    assert.equal(await env.fs.exists("/tmp/a.png"), true);

    for (const verb of ["mv", "cp"]) {
      const r = await call(env, verb, { from: "/tmp/*.png", to: "/out/" });
      assert.equal(r.status, "error");
      assert.match(String(r.message), /takes one path, not a pattern/);
    }

    // A real missing file still says so plainly.
    const missing = await call(env, "rm", { path: "/tmp/nope.txt" });
    assert.match(String(missing.message), /no such file or directory/);
  } finally {
    await env.close({ graceMs: 100 });
  }
});

test("env:std.sleep waits, and is bounded", async () => {
  const env = await createWorkingEnvironment({ limits: { runTimeoutMs: 10_000 } });
  try {
    const waited = await script<number>(
      env,
      `export default async function waits() {
         const std = await import('env:std');
         const t0 = Date.now();
         await std.sleep(120);
         return Date.now() - t0;
       }`,
    );
    assert.ok(waited >= 100, `sleep(120) returned after ${waited}ms`);

    // Bounded, so a mistyped sleep fails fast instead of eating the budget.
    const capped = await script<string>(
      env,
      `export default async function tooLong() {
         const std = await import('env:std');
         try { await std.sleep(600000); return 'no error'; } catch (e) { return e.message; }
       }`,
    );
    assert.match(capped, /exceeds the 60000ms per-call cap/);

    const bad = await script<string>(
      env,
      `export default async function negative() {
         const std = await import('env:std');
         try { await std.sleep(-1); return 'no error'; } catch (e) { return e.message; }
       }`,
    );
    assert.match(bad, /non-negative number/);
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("orientation states the limits instead of making the model discover them", async () => {
  const env = await createWorkingEnvironment({
    limits: { runTimeoutMs: 90_000, maxFileBytes: 4 * 1024 * 1024, maxVersionsPerFile: 3 },
  });
  try {
    const text = await env.fs.readFile("/.env/orientation.md");
    assert.match(text, /## Limits/);
    assert.match(text, /90000ms/);
    assert.match(text, /timeout_ms/, "the limits section does not mention the per-run override");
    assert.match(text, /4\.0MB/);
    assert.match(text, /3 version\(s\) per file/);
  } finally {
    await env.close({ graceMs: 100 });
  }
});

test("diff shows what undo would throw away", async () => {
  const env = await createWorkingEnvironment({});
  try {
    await env.fs.writeFile("/tmp/notes.md", "one\ntwo\nthree\n");
    await env.fs.writeFile("/tmp/notes.md", "one\ntwo point five\nthree\n");

    const out = await callOk(env, "diff", { path: "/tmp/notes.md" });
    assert.match(out, /-two$/m);
    assert.match(out, /\+two point five$/m);
    assert.match(out, / one$/m, "context lines are missing");

    // Unchanged since the last write reads as unchanged, not as an empty diff.
    await env.fs.writeFile("/tmp/same.md", "a\n");
    await env.fs.writeFile("/tmp/same.md", "a\n");
    assert.match(await callOk(env, "diff", { path: "/tmp/same.md" }), /unchanged/);

    // A file with no recorded history says so rather than diffing against nothing.
    const fresh = await call(env, "diff", { path: "/std/README.md" });
    assert.equal(fresh.status, "error");
    assert.match(String(fresh.message), /no earlier version/);
  } finally {
    await env.close({ graceMs: 100 });
  }
});

test("diff against a checkpoint covers creation and deletion too", async () => {
  const env = await createWorkingEnvironment({});
  try {
    await env.fs.writeFile("/tmp/kept.txt", "before\n");
    await env.fs.writeFile("/tmp/gone.txt", "will be deleted\n");
    await callOk(env, "checkpoint", { action: "fork", name: "base" });

    await env.fs.writeFile("/tmp/kept.txt", "after\n");
    await env.fs.rm("/tmp/gone.txt");
    await env.fs.writeFile("/tmp/new.txt", "made later\n");

    const changed = await callOk(env, "diff", { path: "/tmp/kept.txt", checkpoint: "base" });
    assert.match(changed, /checkpoint "base"/);
    assert.match(changed, /-before$/m);
    assert.match(changed, /\+after$/m);

    assert.match(await callOk(env, "diff", { path: "/tmp/new.txt", checkpoint: "base" }), /it is new/);
    assert.match(await callOk(env, "diff", { path: "/tmp/gone.txt", checkpoint: "base" }), /it was removed/);
  } finally {
    await env.close({ graceMs: 100 });
  }
});

test("a run with the wrong arg keys is told the shape its JSDoc declares", async () => {
  const env = await createWorkingEnvironment({});
  try {
    await env.fs.writeFile(
      "/scripts/convert.js",
      `/**
        * Converts a file.
        * @param {{ input: string, format?: string }} args
        * @returns {Promise<{ ok: boolean }>}
        */
       export default async function convert(args) { return { ok: true, saw: Object.keys(args) }; }`,
    );

    const wrong = await callOk(env, "run_script", { path: "/scripts/convert.js", args: { file: "/inbox/a.csv" } });
    assert.match(wrong, /declares args \{ input: string, format\?: string \}/);
    assert.match(wrong, /missing `input`/);
    assert.match(wrong, /unexpected `file`/);
    // Advisory: it ran anyway.
    assert.match(wrong, /"ok": true|"ok":true/);

    // The right shape says nothing at all.
    const right = await callOk(env, "run_script", { path: "/scripts/convert.js", args: { input: "/inbox/a.csv" } });
    assert.doesNotMatch(right, /declares args/);
  } finally {
    await env.close({ graceMs: 200 });
  }
});

test("the arg pre-flight reads the dotted @param form too, and stays quiet without JSDoc", async () => {
  const env = await createWorkingEnvironment({});
  try {
    await env.fs.writeFile(
      "/scripts/dotted.js",
      `/**
        * Builds a report.
        * @param {string} args.source
        * @param {number} [args.limit]
        * @returns {Promise<number>}
        */
       export default async function dotted(args) { return 1; }`,
    );
    const out = await callOk(env, "run_script", { path: "/scripts/dotted.js", args: { limit: 5 } });
    assert.match(out, /missing `source`/);
    assert.doesNotMatch(out, /unexpected/, "`limit` is declared optional and must not be flagged");

    // A script with no JSDoc args is unaffected — the check has nothing to say.
    await env.fs.writeFile(
      "/scripts/bare.js",
      `export default async function bare(args) { return Object.keys(args ?? {}).length; }`,
    );
    const bare = await callOk(env, "run_script", { path: "/scripts/bare.js", args: { anything: 1 } });
    assert.doesNotMatch(bare, /declares args/);
  } finally {
    await env.close({ graceMs: 200 });
  }
});

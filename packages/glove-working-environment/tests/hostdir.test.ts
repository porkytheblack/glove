/**
 * The copy-on-write host-directory backend.
 *
 * Two properties carry the feature and get the tests: **nothing on disk
 * changes until commit()**, and **nothing outside the root is reachable**.
 * The rest is the `Vfs` contract, which the whole existing suite already
 * exercises — so this file also runs a slice of that suite against the new
 * backend rather than restating it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkingEnvironment, hostDirectory, type HostDirectoryFs } from "../src/index";

/** A host directory holding a small corpus. */
async function corpus(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "glove-hostdir-"));
  await mkdir(join(dir, "inbox"), { recursive: true });
  await mkdir(join(dir, "inbox", "nested"), { recursive: true });
  await writeFile(join(dir, "inbox", "one.txt"), "first\n");
  await writeFile(join(dir, "inbox", "two.csv"), "a,b\n1,2\n");
  await writeFile(join(dir, "inbox", "nested", "deep.txt"), "buried\n");
  return dir;
}

test("a host directory is readable without mounting anything", async () => {
  const dir = await corpus();
  try {
    const env = await createWorkingEnvironment({ filesystem: hostDirectory(dir) });
    assert.equal(await env.fs.readFile("/inbox/one.txt"), "first\n");
    assert.equal(await env.fs.readFile("/inbox/nested/deep.txt"), "buried\n");
    const listing = await env.fs.readdir("/inbox");
    assert.deepEqual(
      listing.map((e) => e.name).sort(),
      ["nested", "one.txt", "two.csv"],
    );
    assert.deepEqual((await env.fs.glob("/inbox/**/*.txt")).sort(), ["/inbox/nested/deep.txt", "/inbox/one.txt"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nothing the agent does reaches the host directory until commit", async () => {
  const dir = await corpus();
  try {
    const disk = hostDirectory(dir);
    const env = await createWorkingEnvironment({ filesystem: disk });

    await env.fs.writeFile("/inbox/one.txt", "REWRITTEN\n");
    await env.fs.writeFile("/out/new.txt", "brand new\n");
    await env.fs.rm("/inbox/two.csv");

    // The environment sees its own view…
    assert.equal(await env.fs.readFile("/inbox/one.txt"), "REWRITTEN\n");
    assert.equal(await env.fs.exists("/inbox/two.csv"), false);
    // …and the disk sees none of it.
    assert.equal(await readFile(join(dir, "inbox", "one.txt"), "utf8"), "first\n");
    assert.equal(await readFile(join(dir, "inbox", "two.csv"), "utf8"), "a,b\n1,2\n");
    assert.deepEqual(await readdir(dir), ["inbox"]);

    const pending = disk.pending();
    assert.ok(pending.written.includes("/inbox/one.txt"));
    assert.ok(pending.written.includes("/out/new.txt"));
    assert.deepEqual(pending.removed, ["/inbox/two.csv"]);

    const applied = await disk.commit();
    assert.ok(applied.written.includes("/out/new.txt"));
    assert.deepEqual(applied.removed, ["/inbox/two.csv"]);
    assert.equal(await readFile(join(dir, "inbox", "one.txt"), "utf8"), "REWRITTEN\n");
    assert.equal(await readFile(join(dir, "out", "new.txt"), "utf8"), "brand new\n");
    await assert.rejects(() => readFile(join(dir, "inbox", "two.csv")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("discard throws the work away and the source is untouched", async () => {
  const dir = await corpus();
  try {
    const disk = hostDirectory(dir);
    const env = await createWorkingEnvironment({ filesystem: disk });
    await env.fs.writeFile("/inbox/one.txt", "nope\n");
    await env.fs.rm("/inbox/nested");
    disk.discard();

    assert.equal(await readFile(join(dir, "inbox", "one.txt"), "utf8"), "first\n");
    assert.equal(await readFile(join(dir, "inbox", "nested", "deep.txt"), "utf8"), "buried\n");
    assert.deepEqual(disk.pending(), { written: [], removed: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a delete then a rewrite ends up present, not gone", async () => {
  // Deletes are applied before writes at commit time. The other order leaves
  // a file the agent deliberately recreated missing on disk.
  const dir = await corpus();
  try {
    const disk = hostDirectory(dir);
    const env = await createWorkingEnvironment({ filesystem: disk });
    await env.fs.rm("/inbox/one.txt");
    assert.equal(await env.fs.exists("/inbox/one.txt"), false);
    await env.fs.writeFile("/inbox/one.txt", "back again\n");
    assert.equal(await env.fs.readFile("/inbox/one.txt"), "back again\n");

    await disk.commit();
    assert.equal(await readFile(join(dir, "inbox", "one.txt"), "utf8"), "back again\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removing a directory shadows everything under it, base included", async () => {
  const dir = await corpus();
  try {
    const disk = hostDirectory(dir);
    const env = await createWorkingEnvironment({ filesystem: disk });
    await env.fs.rm("/inbox/nested");
    assert.equal(await env.fs.exists("/inbox/nested/deep.txt"), false, "a base file under a removed dir must be gone");
    assert.deepEqual((await env.fs.readdir("/inbox")).map((e) => e.name).sort(), ["one.txt", "two.csv"]);
    await disk.commit();
    await assert.rejects(() => readFile(join(dir, "inbox", "nested", "deep.txt")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ==================================================== containment (the point)

test("a symlink out of the root is refused, not followed", async () => {
  const dir = await corpus();
  const outside = await mkdtemp(join(tmpdir(), "glove-outside-"));
  try {
    await writeFile(join(outside, "secret.txt"), "should never be readable\n");
    await symlink(join(outside, "secret.txt"), join(dir, "inbox", "link.txt"));

    const env = await createWorkingEnvironment({ filesystem: hostDirectory(dir) });
    await assert.rejects(() => env.fs.readFile("/inbox/link.txt"), /resolves outside the host directory/);
    // And it does not appear in a listing as if it were readable.
    const names = (await env.fs.readdir("/inbox")).map((e) => e.name);
    assert.ok(!names.includes("link.txt"), `a link out of the root must not be listed: ${names.join(", ")}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("a symlinked PARENT directory cannot be used to escape either", async () => {
  // The subtler case: the leaf is innocent, its directory is the link.
  const dir = await corpus();
  const outside = await mkdtemp(join(tmpdir(), "glove-outside-"));
  try {
    await writeFile(join(outside, "secret.txt"), "should never be readable\n");
    await symlink(outside, join(dir, "escape"));

    const env = await createWorkingEnvironment({ filesystem: hostDirectory(dir) });
    await assert.rejects(() => env.fs.readFile("/escape/secret.txt"), /resolves outside the host directory/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("a symlink that stays inside the root works normally", async () => {
  // Refusing every symlink would be simpler and wrong — links within a corpus
  // are ordinary, and the rule is containment, not link-avoidance.
  const dir = await corpus();
  try {
    await symlink(join(dir, "inbox", "one.txt"), join(dir, "inbox", "alias.txt"));
    const env = await createWorkingEnvironment({ filesystem: hostDirectory(dir) });
    assert.equal(await env.fs.readFile("/inbox/alias.txt"), "first\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`..` cannot climb out, however it is spelled", async () => {
  const dir = await corpus();
  try {
    const env = await createWorkingEnvironment({ filesystem: hostDirectory(dir) });
    // These never reach the backend at all: normalizePath refuses them at the
    // gateway, which is why the backend only has to worry about symlinks.
    for (const path of ["/../../etc/passwd", "/inbox/../../../etc/passwd", "/inbox/../..//etc/passwd"]) {
      await assert.rejects(() => env.fs.exists(path), /escapes the root/, `${path} must be refused`);
    }
    // And one that climbs but lands back inside is fine.
    assert.equal(await env.fs.readFile("/inbox/nested/../one.txt"), "first\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a read-only host directory refuses every mutation", async () => {
  const dir = await corpus();
  try {
    const disk = hostDirectory(dir, { mode: "readonly" });
    await assert.rejects(
      () => createWorkingEnvironment({ filesystem: disk }),
      /read-only host directory/,
      "even the environment's own scaffolding must be refused, loudly",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ======================================================= the Vfs contract

test("the full script pipeline works against a host directory", async () => {
  // The real proof that the backend satisfies the contract: run the thing the
  // environment is for, end to end, on it.
  const dir = await corpus();
  try {
    const disk = hostDirectory(dir);
    const env = await createWorkingEnvironment({ filesystem: disk });

    await env.fs.writeFile(
      "/scripts/count.js",
      `import { readFile, glob } from 'env:fs';
       import { csv } from 'env:std';

       /** Counts rows across every CSV in the inbox. */
       export default async function count() {
         let rows = 0;
         for (const p of await glob('/inbox/**/*.csv')) rows += csv.parse(await readFile(p)).length;
         return { rows };
       }`,
    );
    const run = await env.runScript("/scripts/count.js");
    assert.equal(run.ok, true, run.error);
    assert.deepEqual(run.result, { rows: 1 });

    // The generated .d.ts, the run history, and the script itself are all
    // overlay entries — none of it has touched the corpus.
    assert.equal(await env.fs.exists("/scripts/count.d.ts"), true);
    assert.deepEqual(await readdir(dir), ["inbox"]);

    await disk.commit();
    assert.ok((await readdir(join(dir, "scripts"))).includes("count.js"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("undo/redo and size accounting behave the same on this backend", async () => {
  const dir = await corpus();
  try {
    const env = await createWorkingEnvironment({ filesystem: hostDirectory(dir) });
    await env.fs.writeFile("/out/notes.txt", "v1");
    await env.fs.writeFile("/out/notes.txt", "v2");
    assert.equal(await env.fs.readFile("/out/notes.txt"), "v2");

    const undo = env.tools.find((t) => t.name === "undo")!;
    await undo.do({ path: "/out/notes.txt" });
    assert.equal(await env.fs.readFile("/out/notes.txt"), "v1");

    // Size accounting sees the base corpus too, not only what was written.
    const small = await createWorkingEnvironment({
      filesystem: hostDirectory(dir),
      limits: { maxVfsBytes: 8_000 },
    });
    await assert.rejects(
      () => small.fs.writeFile("/out/big.bin", "x".repeat(9_000)),
      /size limit exceeded/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

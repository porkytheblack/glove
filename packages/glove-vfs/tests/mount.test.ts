import { test } from "node:test";
import assert from "node:assert/strict";

import { inMemoryFs, mountFs, toBytes, toText, type Vfs } from "../src/index";

async function names(vfs: Vfs, path: string): Promise<string[]> {
  return (await vfs.list(path)).map((e) => `${e.kind}:${e.name}`).sort();
}

test("the most specific mount wins, whatever the array order", async () => {
  const root = inMemoryFs();
  const memory = inMemoryFs();
  const fs = mountFs([
    { at: "/memory", fs: memory },
    { at: "/", fs: root },
  ]);

  await fs.write("/memory/notes/a.md", toBytes("filed"));
  await fs.write("/work/a.md", toBytes("scratch"));

  // The backend sees the path relative to its mount point.
  assert.equal(toText(await memory.read("/notes/a.md")), "filed");
  assert.equal(toText(await root.read("/work/a.md")), "scratch");
  assert.equal(await root.exists("/memory/notes/a.md"), false);
});

test("directories on the way to a mount stay listable", async () => {
  const fs = mountFs([
    { at: "/", fs: inMemoryFs() },
    { at: "/srv/agents/memory", fs: inMemoryFs() },
  ]);

  assert.deepEqual(await names(fs, "/"), ["dir:srv"]);
  assert.deepEqual(await names(fs, "/srv"), ["dir:agents"]);
  assert.deepEqual(await names(fs, "/srv/agents"), ["dir:memory"]);
  assert.equal((await fs.stat("/srv/agents"))?.kind, "dir");
  assert.equal(await fs.exists("/srv/agents/memory"), true);
});

test("a write above every mount point is refused by name, not silently rerouted", async () => {
  const fs = mountFs([{ at: "/memory", fs: inMemoryFs() }]);
  await assert.rejects(
    () => fs.write("/scratch.txt", toBytes("x")),
    /under no mounted tree.*\/memory/s,
  );
});

test("a mount point cannot be removed, but its contents can", async () => {
  const fs = mountFs([
    { at: "/", fs: inMemoryFs() },
    { at: "/memory", fs: inMemoryFs() },
  ]);
  await fs.write("/memory/notes/a.md", toBytes("x"));

  await assert.rejects(() => fs.rm("/memory"), /mount point/);
  await fs.rm("/memory/notes");
  assert.equal(await fs.exists("/memory/notes/a.md"), false);
  assert.equal(await fs.exists("/memory"), true);
});

test("a read-only mount refuses every mutation and still reads", async () => {
  const corpus = inMemoryFs();
  await corpus.write("/paper.txt", toBytes("published"));
  const fs = mountFs([
    { at: "/", fs: inMemoryFs() },
    { at: "/corpus", fs: corpus, access: "read" },
  ]);

  assert.equal(toText(await fs.read("/corpus/paper.txt")), "published");
  await assert.rejects(() => fs.write("/corpus/paper.txt", toBytes("edited")), /read-only/);
  await assert.rejects(() => fs.rm("/corpus/paper.txt"), /read-only/);
  await assert.rejects(() => fs.mkdir("/corpus/new"), /read-only/);
  // The write never landed anywhere.
  assert.equal(toText(await corpus.read("/paper.txt")), "published");
});

test("files() unions the mounts and lets the deeper one win", async () => {
  const root = inMemoryFs();
  const memory = inMemoryFs();
  // A stale path in the root backend that a deeper mount now shadows.
  await root.write("/memory/ghost.md", toBytes("shadowed"));
  await memory.write("/real.md", toBytes("live"));
  const fs = mountFs([
    { at: "/", fs: root },
    { at: "/memory", fs: memory },
  ]);

  assert.deepEqual(await fs.files(), ["/memory/real.md"]);
});

test("totalSize sums every mount, so one budget covers the whole tree", async () => {
  const fs = mountFs([
    { at: "/", fs: inMemoryFs() },
    { at: "/memory", fs: inMemoryFs() },
  ]);
  await fs.write("/a.bin", new Uint8Array(10));
  await fs.write("/memory/b.bin", new Uint8Array(6));
  assert.equal(await fs.totalSize(), 16);
});

test("rooted:false leaves stored paths absolute", async () => {
  const memory = inMemoryFs();
  const fs = mountFs([
    { at: "/", fs: inMemoryFs() },
    { at: "/memory", fs: memory, rooted: false },
  ]);

  await fs.write("/memory/notes/a.md", toBytes("x"));
  // The backend stored the full path — which is what keeps an absolute-path
  // link stored elsewhere pointing at the right file.
  assert.equal(toText(await memory.read("/memory/notes/a.md")), "x");
  assert.deepEqual(await fs.files(), ["/memory/notes/a.md"]);
});

test("duplicate mount points are refused at construction", () => {
  assert.throws(
    () => mountFs([{ at: "/memory", fs: inMemoryFs() }, { at: "/memory/", fs: inMemoryFs() }]),
    /duplicate mount point/,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { copyTree, inMemoryFs, mountFs, restore, snapshot, toBytes, toText } from "../src/index";

test("a snapshot round-trips through any backend", async () => {
  const source = inMemoryFs();
  await source.write("/a.txt", toBytes("one"));
  await source.write("/dir/b.bin", new Uint8Array([0, 255, 7]));
  await source.mkdir("/empty");

  const snap = await snapshot(source);
  const target = inMemoryFs();
  await restore(target, snap);

  assert.equal(toText(await target.read("/a.txt")), "one");
  assert.deepEqual([...(await target.read("/dir/b.bin"))], [0, 255, 7]);
  assert.equal((await target.stat("/empty"))?.kind, "dir");
});

test("a walked snapshot matches a self-serialized one", async () => {
  // A mounted tree cannot serialize itself, so it is walked — and the result
  // has to be interchangeable with the fast path, or "same snapshot format"
  // is a claim rather than a fact.
  const direct = inMemoryFs();
  await direct.write("/a.txt", toBytes("one"));
  await direct.write("/dir/b.txt", toBytes("two"));

  const mounted = mountFs([{ at: "/", fs: inMemoryFs() }]);
  await mounted.write("/a.txt", toBytes("one"));
  await mounted.write("/dir/b.txt", toBytes("two"));

  const a = await snapshot(direct);
  const b = await snapshot(mounted);
  assert.deepEqual(
    a.files.map((f) => [f.path, f.data]),
    b.files.map((f) => [f.path, f.data]),
  );
});

test("restore is additive unless asked to clear", async () => {
  const target = inMemoryFs();
  await target.write("/keep.txt", toBytes("kept"));
  await target.write("/stale.txt", toBytes("stale"));

  const source = inMemoryFs();
  await source.write("/keep.txt", toBytes("kept"));
  const snap = await snapshot(source);

  await restore(target, snap);
  assert.equal(await target.exists("/stale.txt"), true);

  await restore(target, snap, { clear: true });
  assert.equal(await target.exists("/stale.txt"), false);
  assert.equal(toText(await target.read("/keep.txt")), "kept");
});

test("an unknown snapshot version is refused rather than half-applied", async () => {
  await assert.rejects(
    () => restore(inMemoryFs(), { version: 2, dirs: [], files: [] } as never),
    /unsupported snapshot version/,
  );
});

test("copyTree migrates between backends", async () => {
  const from = inMemoryFs();
  await from.write("/a.txt", toBytes("one"));
  await from.write("/dir/b.txt", toBytes("two"));

  const to = mountFs([
    { at: "/", fs: inMemoryFs() },
    { at: "/dir", fs: inMemoryFs() },
  ]);
  assert.equal(await copyTree(from, to), 2);
  assert.equal(toText(await to.read("/dir/b.txt")), "two");
});

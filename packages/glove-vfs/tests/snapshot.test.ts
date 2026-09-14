import { test } from "node:test";
import assert from "node:assert/strict";

import { copyTree, inMemoryFs, mountFs, restore, snapshot, toBytes, toText, withAccess, withMeta } from "../src/index";

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

// The regression that motivated `unwrap`. Both layers narrow what a caller
// sees — the metadata layer hides its own sidecar, a policy hides fenced
// paths — and a snapshot that inherits that narrowing restores a DIFFERENT
// tree while the file bytes come back intact enough to look like it worked.
test("metadata survives snapshot → restore", async () => {
  const src = withMeta(inMemoryFs(), { lexical: true });
  await src.write("/note.md", toBytes("body"));
  await src.setMeta(
    "/note.md",
    { summary: "kept", tags: ["x"], links: [{ kind: "entity", id: "e1" }] },
    { source: "test", actor: "suite", timestamp: new Date().toISOString() },
  );

  const target = withMeta(inMemoryFs(), { lexical: true });
  await restore(target, await snapshot(src));

  const rec = await target.getMeta("/note.md");
  assert.equal(rec?.metadata.summary, "kept");
  assert.deepEqual(rec?.metadata.tags, ["x"]);
  assert.equal(rec?.provenance.length, 1);
  assert.deepEqual(
    (await target.linksFor("entity", "e1")).map((l) => l.path),
    ["/note.md"],
  );
  // …and the sidecar is still bookkeeping on the far side, not content.
  assert.deepEqual(await target.files(), ["/note.md"]);
});

test("restore invalidates a layer that had already read the old index", async () => {
  const target = withMeta(inMemoryFs(), { lexical: true });
  await target.write("/note.md", toBytes("old"));
  await target.setMeta("/note.md", { summary: "stale" });
  // Force the index to be cached before the restore writes underneath it.
  assert.equal((await target.getMeta("/note.md"))?.metadata.summary, "stale");

  const src = withMeta(inMemoryFs(), { lexical: true });
  await src.write("/note.md", toBytes("new"));
  await src.setMeta("/note.md", { summary: "fresh" });
  await restore(target, await snapshot(src), { clear: true });

  assert.equal((await target.getMeta("/note.md"))?.metadata.summary, "fresh");
});

test("a snapshot captures access-fenced paths, because a restore must rebuild them", async () => {
  const base = inMemoryFs();
  await base.write("/corpus/paper.txt", toBytes("published"));
  await base.write("/work/draft.md", toBytes("mine"));
  const guarded = withAccess(base, { rules: [{ path: "/corpus", access: "none" }] });

  assert.deepEqual(await guarded.files(), ["/work/draft.md"]);
  const snap = await snapshot(guarded);
  assert.deepEqual(snap.files.map((f) => f.path).sort(), ["/corpus/paper.txt", "/work/draft.md"]);
});

test("copyTree carries metadata across backends", async () => {
  const from = withMeta(inMemoryFs(), { lexical: true });
  await from.write("/a.md", toBytes("body"));
  await from.setMeta("/a.md", { summary: "carried" });

  const to = withMeta(inMemoryFs(), { lexical: true });
  await copyTree(from, to);
  assert.equal((await to.getMeta("/a.md"))?.metadata.summary, "carried");
});

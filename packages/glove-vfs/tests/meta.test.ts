import { test } from "node:test";
import assert from "node:assert/strict";

import {
  META_INDEX_PATH,
  hasMeta,
  hasSearch,
  inMemoryFs,
  toBytes,
  withMeta,
  type VfsProvenance,
} from "../src/index";

const prov = (note: string): VfsProvenance => ({
  source: "test",
  actor: "suite",
  timestamp: new Date().toISOString(),
  note,
});

test("a plain tree gains the metadata capability and advertises it honestly", async () => {
  const plain = inMemoryFs();
  assert.equal(hasMeta(plain), false);

  const fs = withMeta(plain);
  assert.equal(hasMeta(fs), true);
  // No embedder and no lexical scorer means no search — and it must not
  // pretend otherwise.
  assert.equal(hasSearch(fs), false);
  assert.equal(hasSearch(withMeta(inMemoryFs(), { lexical: true })), true);
});

test("a write registers the file; a rewrite marks the index stale", async () => {
  const fs = withMeta(inMemoryFs());
  await fs.write("/notes/a.md", toBytes("first"));

  let rec = await fs.getMeta("/notes/a.md");
  assert.equal(rec?.embeddingStatus, "missing");
  assert.deepEqual(rec?.metadata.tags, []);

  await fs.setEmbedding?.("/notes/a.md", [1, 0, 0]);
  await fs.write("/notes/a.md", toBytes("second"));
  rec = await fs.getMeta("/notes/a.md");
  assert.equal(rec?.embeddingStatus, "stale");
});

test("metadata patches merge and provenance only ever accumulates", async () => {
  const fs = withMeta(inMemoryFs());
  await fs.write("/notes/a.md", toBytes("x"));

  await fs.setMeta("/notes/a.md", { summary: "A note", tags: ["draft"] }, prov("created"));
  await fs.setMeta("/notes/a.md", { tags: ["draft", "reviewed"] }, prov("reviewed"));

  const rec = await fs.getMeta("/notes/a.md");
  assert.equal(rec?.metadata.summary, "A note");
  assert.deepEqual(rec?.metadata.tags, ["draft", "reviewed"]);
  assert.deepEqual(
    rec?.provenance.map((p) => p.note),
    ["created", "reviewed"],
  );
});

test("links resolve in reverse and rewrite in bulk", async () => {
  const fs = withMeta(inMemoryFs());
  await fs.write("/notes/a.md", toBytes("a"));
  await fs.write("/notes/b.md", toBytes("b"));
  await fs.setMeta("/notes/a.md", { links: [{ kind: "entity", id: "person:1", relation: "about" }] }, prov("link"));
  await fs.setMeta("/notes/b.md", { links: [{ kind: "entity", id: "person:1" }] }, prov("link"));

  assert.deepEqual(
    (await fs.linksFor("entity", "person:1")).map((l) => l.path),
    ["/notes/a.md", "/notes/b.md"],
  );

  assert.equal(await fs.replaceLinkTarget("entity", "person:1", "person:2", prov("merge")), 2);
  assert.equal((await fs.linksFor("entity", "person:1")).length, 0);
  assert.equal((await fs.linksFor("entity", "person:2")).length, 2);
});

test("removing a directory drops the metadata under it", async () => {
  const fs = withMeta(inMemoryFs());
  await fs.write("/notes/a.md", toBytes("a"));
  await fs.write("/notes/sub/b.md", toBytes("b"));
  await fs.rm("/notes");

  assert.equal(await fs.getMeta("/notes/a.md"), null);
  assert.equal(await fs.getMeta("/notes/sub/b.md"), null);
});

test("the sidecar is bookkeeping, not content", async () => {
  const fs = withMeta(inMemoryFs());
  await fs.write("/notes/a.md", toBytes("a"));
  await fs.setMeta("/notes/a.md", { summary: "s" });

  assert.ok(!(await fs.files()).includes(META_INDEX_PATH));
  assert.deepEqual(
    (await fs.list("/.vfs")).map((e) => e.name),
    [],
  );
  // Still readable by a host that wants to inspect or back it up.
  assert.equal(await fs.exists(META_INDEX_PATH), true);
});

test("lexical search ranks by relevance and needs no service", async () => {
  const fs = withMeta(inMemoryFs(), { lexical: true });
  await fs.write("/notes/pricing.md", toBytes("Our pricing tiers and billing cadence."));
  await fs.write("/notes/hiring.md", toBytes("Interview loops and hiring panels."));

  const hits = await fs.searchSemantic!("billing pricing");
  assert.equal(hits[0]?.path, "/notes/pricing.md");
  assert.ok(hits[0]!.score > (hits[1]?.score ?? 0));
});

test("the embedding lifecycle is a queue the host drains out of band", async () => {
  const fs = withMeta(inMemoryFs(), {
    embedder: { dimensions: 2, embed: async (texts) => texts.map((t) => [t.length, 1]) },
  });
  await fs.write("/notes/a.md", toBytes("a"));
  await fs.write("/notes/b.md", toBytes("b"));

  assert.deepEqual(await fs.findNeedingEmbedding!(), ["/notes/a.md", "/notes/b.md"]);
  await fs.setEmbedding!("/notes/a.md", [1, 1]);
  assert.deepEqual(await fs.findNeedingEmbedding!(), ["/notes/b.md"]);
  assert.equal((await fs.getMeta("/notes/a.md"))?.embeddingStatus, "fresh");
});

test("a corrupt sidecar loses metadata, never content", async () => {
  const inner = inMemoryFs();
  const fs = withMeta(inner);
  await fs.write("/notes/a.md", toBytes("important"));
  await fs.setMeta("/notes/a.md", { summary: "s" });

  await inner.write(META_INDEX_PATH, toBytes("{not json"));
  const fresh = withMeta(inner);
  assert.equal(await fresh.getMeta("/notes/a.md"), null);
  assert.equal((await fresh.files()).includes("/notes/a.md"), true);
});

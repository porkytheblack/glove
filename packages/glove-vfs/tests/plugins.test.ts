/**
 * The point of the package, tested end to end: a working environment, a
 * memory resource store and a REPL session are three views of ONE tree, not
 * three trees.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { inMemoryFs, mountFs, toBytes, toText, withAccess, withMeta } from "../src/index";
import { fsFns } from "../src/fns";
import { vfsResources } from "../src/resources";
import type { Vfs } from "../src/types";

const prov = () => ({ source: "test", actor: "suite", timestamp: new Date().toISOString() });

function tree(): ReturnType<typeof withMeta> {
  return withMeta(
    mountFs([
      { at: "/", fs: inMemoryFs() },
      { at: "/memory", fs: inMemoryFs() },
    ]),
    { lexical: true },
  );
}

async function callFn(fns: ReturnType<typeof fsFns>, name: string, args: Record<string, unknown>) {
  const fn = fns.find((f) => f.name === name);
  assert.ok(fn, `no such function: ${name} (have ${fns.map((f) => f.name).join(", ")})`);
  return fn.call(args);
}

test("a file a script wrote is a resource the memory tools can read", async () => {
  const fs = tree();
  const resources = vfsResources(fs, { schema: { marker: "schema" }, root: "/memory" });

  // The "working environment" side: plain bytes at a path.
  await fs.write("/memory/notes/findings.md", toBytes("# Findings\nRevenue is up."));

  // The memory side reads the same bytes, at the same path, with no copy.
  const file = await resources.read("/memory/notes/findings.md", { range: [1, -1] });
  assert.equal(file.body.type, "markdown");
  assert.equal((file.body as { text: string }).text, "# Findings\nRevenue is up.");
  assert.deepEqual(file.metadata.tags, []);

  const listed = await resources.list("/memory/notes");
  assert.deepEqual(
    listed.map((e) => e.name),
    ["findings.md"],
  );
});

test("a resource the curator filed is a file a script can read", async () => {
  const fs = tree();
  const resources = vfsResources(fs, { schema: {}, root: "/memory" });

  await resources.write(
    "/memory/notes/brief.md",
    { type: "markdown", text: "Q3 brief" },
    { summary: "The Q3 brief", tags: ["brief"], links: [{ kind: "entity", id: "org:1" }] },
    prov(),
  );

  assert.equal(toText(await fs.read("/memory/notes/brief.md")), "Q3 brief");
  const rec = await fs.getMeta("/memory/notes/brief.md");
  assert.equal(rec?.metadata.summary, "The Q3 brief");
  assert.deepEqual(await resources.linksFor("entity", "org:1"), ["/memory/notes/brief.md"]);
});

test("the REPL functions act on the same tree, and only offer what it supports", async () => {
  const fs = tree();
  const fns = fsFns(fs);
  const names = fns.map((f) => f.name);

  assert.ok(names.includes("fs__read"));
  assert.ok(names.includes("fs__write"));
  assert.ok(names.includes("fs__meta"), "a metadata tree should offer fs.meta");
  assert.ok(names.includes("fs__search"), "a searchable tree should offer fs.search");
  assert.ok(fns.every((f) => f.server === "fs"));

  await callFn(fns, "fs__write", { path: "/memory/notes/a.md", content: "from the repl" });
  assert.equal(toText(await fs.read("/memory/notes/a.md")), "from the repl");

  const resources = vfsResources(fs, { schema: {}, root: "/memory" });
  const file = await resources.read("/memory/notes/a.md", { range: [1, -1] });
  assert.equal((file.body as { text: string }).text, "from the repl");
});

test("a plain tree offers no metadata or search functions rather than broken ones", () => {
  const names = fsFns(inMemoryFs()).map((f) => f.name);
  assert.ok(!names.includes("fs__meta"));
  assert.ok(!names.includes("fs__search"));
  assert.ok(names.includes("fs__read"));
});

test("readOnly drops every mutating function", () => {
  const names = fsFns(tree(), { readOnly: true }).map((f) => f.name);
  for (const mutating of ["fs__write", "fs__rm", "fs__mv", "fs__cp", "fs__mkdir", "fs__set_meta"]) {
    assert.ok(!names.includes(mutating), `${mutating} should be absent`);
  }
  assert.ok(names.includes("fs__read"));
});

test("REPL functions inherit the access policy, because it lives on the filesystem", async () => {
  const guarded = withAccess(tree() as Vfs, {
    rules: [{ path: "/memory/archive", access: "read", note: "sealed" }],
  });
  const fns = fsFns(guarded);
  await guarded.write("/memory/notes/a.md", toBytes("ok"));

  await assert.rejects(
    () => callFn(fns, "fs__write", { path: "/memory/archive/x.md", content: "nope" }),
    /read-only.*sealed/s,
  );
});

test("a big read is refused with the search that replaces it", async () => {
  const fs = inMemoryFs();
  await fs.write("/big.txt", toBytes("x".repeat(5000)));
  const fns = fsFns(fs, { maxReadBytes: 1000 });

  await assert.rejects(() => callFn(fns, "fs__read", { path: "/big.txt" }), /fs\.grep/);
  // A slice is still available.
  await fs.write("/lines.txt", toBytes("one\ntwo\nthree\nfour"));
  assert.equal(await callFn(fns, "fs__read", { path: "/lines.txt", offset: 2, limit: 2 }), "two\nthree");
});

test("binary content is refused as text and available as base64", async () => {
  const fs = inMemoryFs();
  await fs.write("/blob.bin", new Uint8Array([0, 1, 2, 255]));
  const fns = fsFns(fs);

  await assert.rejects(() => callFn(fns, "fs__read", { path: "/blob.bin" }), /binary/);
  const b64 = await callFn(fns, "fs__read", { path: "/blob.bin", encoding: "base64" });
  assert.equal(b64, Buffer.from([0, 1, 2, 255]).toString("base64"));
});

test("the resource store is scoped without rewriting paths", async () => {
  const fs = tree();
  const resources = vfsResources(fs, { schema: {}, root: "/memory" });
  await fs.write("/work/scratch.md", toBytes("not a resource"));
  await resources.write("/memory/a.md", { type: "markdown", text: "a" }, { tags: [], links: [] }, prov());

  // Stored where it was named — an absolute link to it stays valid.
  assert.ok((await fs.files()).includes("/memory/a.md"));
  assert.equal(await resources.exists("/work/scratch.md"), false);
  await assert.rejects(() => resources.read("/work/scratch.md"), /outside this resource store/);
  assert.deepEqual(await resources.glob("/**/*.md"), ["/memory/a.md"]);
});

test("edit replaces a unique substring and refuses an ambiguous one", async () => {
  const fs = tree();
  const resources = vfsResources(fs, { schema: {}, root: "/memory" });
  await resources.write("/memory/a.md", { type: "markdown", text: "one two one" }, { tags: [], links: [] }, prov());

  await assert.rejects(() => resources.edit("/memory/a.md", "one", "1", prov()), /more than once/);
  await resources.edit("/memory/a.md", "two", "2", prov());
  assert.equal(toText(await fs.read("/memory/a.md")), "one 2 one");
});

test("a URL resource round-trips through a byte filesystem", async () => {
  const fs = tree();
  const resources = vfsResources(fs, { schema: {}, root: "/memory" });
  await resources.write(
    "/memory/link.json",
    { type: "url", url: "https://example.com/paper", cachedText: "abstract" },
    { tags: [], links: [] },
    prov(),
  );

  const file = await resources.read("/memory/link.json");
  assert.equal(file.body.type, "url");
  assert.equal((file.body as { url: string }).url, "https://example.com/paper");
  assert.equal((file.body as { cachedText?: string }).cachedText, "abstract");
});

test("semantic search on the resource store is scoped and reports support honestly", async () => {
  const fs = tree();
  const resources = vfsResources(fs, { schema: {}, root: "/memory" });
  assert.equal(resources.supportsSemanticSearch, true);

  await fs.write("/memory/pricing.md", toBytes("billing and pricing tiers"));
  await fs.write("/work/pricing.md", toBytes("billing and pricing tiers"));

  const hits = await resources.searchSemantic!("pricing");
  assert.deepEqual(
    hits.map((h) => h.path),
    ["/memory/pricing.md"],
  );

  const plain = vfsResources(inMemoryFs(), { schema: {} });
  assert.equal(plain.supportsSemanticSearch, false);
  assert.equal(plain.searchSemantic, undefined);
});

test("the embedding queue hands back content, not paths", async () => {
  const fs = withMeta(inMemoryFs(), {
    embedder: { dimensions: 1, embed: async (t) => t.map(() => [1]) },
  });
  const resources = vfsResources(fs, { schema: {} });
  await fs.write("/a.md", toBytes("body text"));

  const pending = await resources.findFilesNeedingEmbedding!();
  assert.deepEqual(pending, [{ path: "/a.md", content: "body text" }]);
  await resources.setEmbedding!("/a.md", [1]);
  assert.deepEqual(await resources.findFilesNeedingEmbedding!(), []);
});

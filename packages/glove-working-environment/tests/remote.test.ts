/**
 * The object-store-backed filesystem.
 *
 * Two things are being pinned here. First, that it behaves *identically* to
 * `InMemoryFs` — the environment above it makes no allowance for a different
 * backend, so any divergence is a bug that would surface as a mystery three
 * layers up. Second, that the index actually earns its keep: the whole-tree
 * operations must not touch the network, because the byte-budget check runs
 * on every single write.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { cachedRemote, createWorkingEnvironment, inMemoryFs, type ObjectStore, type RemoteObject } from "../src/index";

/** A store that counts what it was asked to do. */
class FakeStore implements ObjectStore {
  objects = new Map<string, Uint8Array>();
  calls = { get: 0, put: 0, delete: 0, list: 0 };

  async get(key: string): Promise<Uint8Array> {
    this.calls.get++;
    const value = this.objects.get(key);
    if (!value) throw new Error(`NoSuchKey: ${key}`);
    return value;
  }
  async put(key: string, data: Uint8Array): Promise<void> {
    this.calls.put++;
    this.objects.set(key, data);
  }
  async delete(key: string): Promise<void> {
    this.calls.delete++;
    this.objects.delete(key);
  }
  async list(prefix: string): Promise<RemoteObject[]> {
    this.calls.list++;
    return [...this.objects.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([key, value]) => ({ key, size: value.byteLength }));
  }
  reset() {
    this.calls = { get: 0, put: 0, delete: 0, list: 0 };
  }
}

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

test("round-trips a file through the store", async () => {
  const store = new FakeStore();
  const fs = await cachedRemote(store);

  await fs.write("/a/b.txt", bytes("hello"));
  assert.equal(text(await fs.read("/a/b.txt")), "hello");
  assert.equal(await fs.totalSize(), 5);
  assert.deepEqual(await fs.files(), ["/a/b.txt"]);

  // The store holds it under the real key, not some internal encoding.
  assert.equal(text(store.objects.get("a/b.txt")!), "hello");
});

test("the index answers structure without touching the network", async () => {
  const store = new FakeStore();
  const fs = await cachedRemote(store);
  await fs.write("/one.txt", bytes("1"));
  await fs.write("/dir/two.txt", bytes("22"));
  store.reset();

  await fs.files();
  await fs.totalSize();
  await fs.list("/");
  await fs.stat("/one.txt");
  await fs.exists("/dir");

  assert.deepEqual(
    store.calls,
    { get: 0, put: 0, delete: 0, list: 0 },
    "whole-tree operations must be served from the index — totalSize() runs on every write",
  );
});

test("content is cached, so a re-read costs nothing", async () => {
  const store = new FakeStore();
  const fs = await cachedRemote(store);
  await fs.write("/x.txt", bytes("payload"));
  store.reset();

  assert.equal(text(await fs.read("/x.txt")), "payload");
  assert.equal(store.calls.get, 0, "the write should have seeded the cache");

  fs.clearCache();
  assert.equal(text(await fs.read("/x.txt")), "payload");
  assert.equal(store.calls.get, 1, "a cold read goes to the store exactly once");
  await fs.read("/x.txt");
  assert.equal(store.calls.get, 1, "and is cached afterwards");
});

test("the cache respects its byte ceiling", async () => {
  const store = new FakeStore();
  const fs = await cachedRemote(store, { maxCacheBytes: 10 });
  await fs.write("/a", bytes("aaaaa"));
  await fs.write("/b", bytes("bbbbb"));
  await fs.write("/c", bytes("ccccc")); // evicts /a
  store.reset();

  await fs.read("/c");
  assert.equal(store.calls.get, 0);
  await fs.read("/a");
  assert.equal(store.calls.get, 1, "the least recently used entry was evicted");
});

test("a reopened prefix sees the same tree", async () => {
  const store = new FakeStore();
  const first = await cachedRemote(store, { prefix: "s1/" });
  await first.write("/notes/a.md", bytes("alpha"));
  await first.mkdir("/empty");

  const second = await cachedRemote(store, { prefix: "s1/" });
  assert.deepEqual(await second.files(), ["/notes/a.md"]);
  assert.equal(text(await second.read("/notes/a.md")), "alpha");
  assert.equal(await second.totalSize(), 5);
  // Derived from the file key…
  assert.deepEqual(await second.stat("/notes"), { kind: "dir", size: 0, mtime: 0 });
  // …and from the explicit marker, which is the only thing that can carry it.
  assert.deepEqual(await second.stat("/empty"), { kind: "dir", size: 0, mtime: 0 });
});

test("prefixes isolate one environment from another", async () => {
  const store = new FakeStore();
  const a = await cachedRemote(store, { prefix: "a/" });
  const b = await cachedRemote(store, { prefix: "b/" });

  await a.write("/shared-name.txt", bytes("from a"));
  await b.write("/shared-name.txt", bytes("from b"));

  assert.equal(text(await a.read("/shared-name.txt")), "from a");
  assert.equal(text(await b.read("/shared-name.txt")), "from b");
  assert.deepEqual(await b.files(), ["/shared-name.txt"]);
});

test("removing a directory clears its content and its markers", async () => {
  const store = new FakeStore();
  const fs = await cachedRemote(store);
  await fs.write("/tree/a.txt", bytes("a"));
  await fs.write("/tree/deep/b.txt", bytes("b"));
  await fs.mkdir("/tree/empty");

  await fs.rm("/tree");

  assert.deepEqual(await fs.files(), []);
  assert.equal(await fs.totalSize(), 0);
  assert.equal(await fs.exists("/tree"), false);
  assert.equal(store.objects.size, 0, "no marker may survive to resurrect the directory");

  const reopened = await cachedRemote(store);
  assert.equal(await reopened.exists("/tree"), false);
});

test("a failed write leaves the index honest", async () => {
  const store = new FakeStore();
  const fs = await cachedRemote(store);
  store.put = async () => {
    throw new Error("503 SlowDown");
  };

  await assert.rejects(() => fs.write("/nope.txt", bytes("data")), /SlowDown/);
  assert.equal(await fs.exists("/nope.txt"), false, "the index must not claim a file the store refused");
  assert.equal(await fs.totalSize(), 0);
});

test("matches InMemoryFs on the error cases the environment relies on", async () => {
  const store = new FakeStore();
  const remote = await cachedRemote(store);
  const memory = inMemoryFs();

  for (const fs of [remote, memory]) {
    await fs.write("/file.txt", bytes("x"));
    await fs.mkdir("/dir");

    await assert.rejects(() => fs.read("/missing"), /no such file/);
    await assert.rejects(() => fs.read("/dir"), /it is a directory/);
    await assert.rejects(() => fs.write("/dir", bytes("x")), /it is a directory/);
    await assert.rejects(() => fs.write("/file.txt/under", bytes("x")), /is a file/);
    await assert.rejects(() => fs.mkdir("/file.txt"), /it is a file/);
    await assert.rejects(() => fs.rm("/"), /cannot remove the root/);
    await assert.rejects(() => fs.rm("/missing"), /no such file or directory/);
    await assert.rejects(() => fs.list("/file.txt"), /not a directory/);
    await assert.rejects(() => fs.list("/missing"), /no such directory/);
  }
});

test("matches InMemoryFs on listing order and shape", async () => {
  const store = new FakeStore();
  const remote = await cachedRemote(store);
  const memory = inMemoryFs();

  for (const fs of [remote, memory]) {
    await fs.write("/z.txt", bytes("zz"));
    await fs.write("/a.txt", bytes("a"));
    await fs.write("/sub/nested.txt", bytes("n"));
    await fs.mkdir("/adir");
  }

  assert.deepEqual(await remote.list("/"), await memory.list("/"));
  assert.deepEqual(await remote.list("/"), [
    { name: "adir", kind: "dir", size: 0 },
    { name: "sub", kind: "dir", size: 0 },
    { name: "a.txt", kind: "file", size: 1 },
    { name: "z.txt", kind: "file", size: 2 },
  ]);
  assert.deepEqual(await remote.files(), await memory.files());
});

test("overwriting a file corrects the byte total rather than double-counting", async () => {
  const store = new FakeStore();
  const fs = await cachedRemote(store);
  await fs.write("/f", bytes("aaaaa"));
  await fs.write("/f", bytes("b"));
  assert.equal(await fs.totalSize(), 1);
  assert.equal(text(await fs.read("/f")), "b");
});

test("a real working environment runs on it end to end", async () => {
  const store = new FakeStore();
  const env = await createWorkingEnvironment({
    filesystem: await cachedRemote(store, { prefix: "session-1/" }),
  });

  try {
    await env.mount({ text: "id,qty\na,2\nb,40\n" }, "/inbox/data.csv");
    await env.fs.writeFile(
      "/scripts/total.js",
      `import { readFile } from 'env:fs';
       import { csv } from 'env:std';
       export default async function () {
         const rows = csv.parse(await readFile('/inbox/data.csv'));
         return rows.reduce((n, r) => n + Number(r.qty), 0);
       }`,
    );

    const run = await env.runScript("/scripts/total.js");
    assert.equal(run.ok, true, run.ok ? "" : JSON.stringify(run));
    assert.equal(run.result, 42);

    // The generated .d.ts sibling and the run log landed in the store too.
    assert.ok(store.objects.has("session-1/scripts/total.d.ts"));
    assert.ok([...store.objects.keys()].some((k) => k.includes("history.jsonl")));

    // And the whole tree survives a reopen — this is the point of the backend.
    const reopened = await createWorkingEnvironment({
      filesystem: await cachedRemote(store, { prefix: "session-1/" }),
    });
    try {
      const again = await reopened.runScript("/scripts/total.js");
      assert.equal(again.ok, true);
      assert.equal(again.result, 42);
    } finally {
      await reopened.close();
    }
  } finally {
    await env.close();
  }
});

test("directory removal is bounded, not a thundering herd", async () => {
  const store = new FakeStore();
  const fs = await cachedRemote(store, { deleteConcurrency: 4 });
  for (let i = 0; i < 50; i++) await fs.write(`/tmp/f${i}`, bytes("x"));

  let inFlight = 0;
  let peak = 0;
  store.delete = async (key: string) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    store.objects.delete(key);
    inFlight--;
  };

  await fs.rm("/tmp");
  assert.equal(await fs.exists("/tmp"), false);
  assert.deepEqual(await fs.files(), []);
  assert.ok(peak <= 4, `expected at most 4 concurrent deletes, saw ${peak}`);
});

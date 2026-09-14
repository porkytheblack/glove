import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, stat, symlink, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test, type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { serialize } from "node:v8";
import { z } from "zod";
import { createSqliteMemoryAdapters, MemoryStorageError } from "../src/sqlite/index";
import { buildResourcesWriteTool } from "../src/tools/resources/write";
import { schema, provenance as p } from "./fixtures/sqlite-worker";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "glove-memory-sqlite-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "private", "memory.sqlite");
  const create = (namespace = "owner") => createSqliteMemoryAdapters({ file, namespace, schema, fuzzySearch: true });
  return { directory, file, create };
}
async function worker(mode: string, file: string, namespace = "owner", id = "0") {
  const result = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./fixtures/sqlite-worker.ts", import.meta.url)), mode, file, namespace, id], { timeout: 30_000 });
  return result.stdout.trim();
}

test("resource tools advertise an explicit object body while retaining discriminated validation", async t => {
  const { create } = await fixture(t);
  const tool = buildResourcesWriteTool(create().resources);
  const input = tool.inputSchema!;
  const json = z.toJSONSchema(input);
  const body = json.properties?.body;
  assert.ok(body && typeof body === "object");
  assert.equal(body.type, "object");
  assert.equal(body.oneOf?.length, 3);
  assert.equal(input.safeParse({ path: "/notes/probe", body: { type: "markdown", text: "probe" } }).success, true);
  assert.equal(input.safeParse({ path: "/notes/probe", body: "probe" }).success, false);
  assert.equal(input.safeParse({ path: "/notes/probe", body: { type: "url", text: "not a URL body" } }).success, false);
});

test("all four native memory surfaces survive process exit with stable IDs, provenance and complete resource bodies", async t => {
  const { file, create } = await fixture(t);
  const written = JSON.parse(await worker("write", file));
  const read = JSON.parse(await worker("read", file));
  assert.equal(read.people[0].id, written.person.id);
  assert.equal(read.episodes[0].id, written.episode.id);
  assert.equal(read.context[0].id, written.context.id);
  assert.deepEqual(read.people[0].provenance, [p]);
  assert.deepEqual(read.episodes[0].participants, [{ entityId: written.person.id }]);
  assert.equal(read.file.body.text.split("\n").length, 80);
  assert.ok(read.directories.some((item: { path: string }) => item.path === "/notes/empty"));
  assert.match(read.prompt, /Cobalt is preferred/);
  const memory = create();
  assert.equal((await memory.entity.getNodeWithNeighbours(written.person.id))?.neighbours[0]?.edgeId, written.edge.id);
  assert.equal((await memory.episodic.searchEpisodes!("Cobalt launch"))[0]?.episode.id, written.episode.id);
  assert.deepEqual(await memory.resources.linksFor("entity", written.person.id), ["/notes/launch.md"]);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("fresh and already-created handles see latest state while namespaces remain isolated", async t => {
  const { create } = await fixture(t);
  const first = create(); const second = create(); const other = create("other-owner");
  const node = await first.entity.addNode("Person", { name: "Mira", extra: { date: new Date(p.timestamp), count: 12n } }, p);
  assert.equal((await second.entity.getNode(node.id))?.props.name, "Mira");
  assert.deepEqual((await second.entity.getNode(node.id))?.props.extra, { date: new Date(p.timestamp), count: 12n });
  assert.equal(await other.entity.getNode(node.id), null);
  await first.episodic.recordEpisode({ kind: "lesson", content: "private", occurredAt: p.timestamp, participants: [] }, p);
  await first.resources.write("/notes/private", { type: "text", text: "private" }, { tags: [], links: [] }, p);
  await first.context.set({ section: "private", content: "private", pinned: true }, p);
  assert.deepEqual(await other.episodic.findEpisodes({}), []);
  assert.equal(await other.resources.exists("/notes/private"), false);
  assert.deepEqual(await other.context.list(), []);
  await second.entity.updateNode(node.id, { notes: "updated" }, p);
  assert.equal((await first.entity.getNode(node.id))?.props.notes, "updated");
  await Promise.all(Array.from({ length: 10 }, (_, i) => create().context.set({ section: "parallel", content: String(i), pinned: false }, p)));
  assert.equal((await first.context.list("parallel")).length, 10);
});

test("concurrent worker writes have no lost episodes or duplicate identities", async t => {
  const { file, create } = await fixture(t);
  await Promise.all(Array.from({ length: 6 }, (_, i) => worker("append", file, "owner", String(i))));
  const memory = create();
  const episodes = await memory.episodic.findEpisodes({});
  assert.equal(episodes.length, 60);
  assert.equal(new Set(episodes.map(episode => episode.content)).size, 60);
  assert.equal((await memory.entity.findNodes("Person", {})).length, 1);
});

test("native updates, merges, rewrites, removals and expiry remain durable", async t => {
  const { create } = await fixture(t);
  const memory = create();
  const keep = await memory.entity.addNode("Person", { name: "Mira" }, p);
  const merge = await memory.entity.addNode("Person", { name: "Mira alias", notes: "merged note" }, p);
  const project = await memory.entity.addNode("Project", { name: "Atlas" }, p);
  const edge = await memory.entity.connect(merge.id, project.id, "worksOn", undefined, p);
  const episode = await memory.episodic.recordEpisode({ kind: "lesson", content: "old", occurredAt: p.timestamp, participants: [{ entityId: merge.id }] }, p);
  await memory.entity.mergeNodes(keep.id, merge.id, p);
  assert.equal(await create().entity.getNode(merge.id), null);
  assert.equal((await create().entity.getNodeWithNeighbours(keep.id))?.neighbours[0]?.edgeId, edge.id);
  assert.equal((await create().entity.getNode(keep.id))?.props.notes, "merged note");
  await memory.episodic.replaceParticipantId(merge.id, keep.id, p);
  await memory.episodic.updateEpisode(episode.id, { content: "new" }, p);
  assert.equal((await create().episodic.episodesForEntity(keep.id))[0]?.content, "new");
  await memory.resources.write("/notes/a", { type: "text", text: "before" }, { tags: [], links: [{ kind: "entity", id: merge.id }] }, p);
  await memory.resources.edit("/notes/a", "before", "after", p);
  await memory.resources.setMetadata("/notes/a", { tags: ["updated"] }, p);
  await memory.resources.replaceLinkTarget("entity", merge.id, keep.id, p);
  await memory.resources.move("/notes/a", "/notes/b", p);
  assert.deepEqual(await create().resources.linksFor("entity", keep.id), ["/notes/b"]);
  assert.deepEqual((await create().resources.read("/notes/b")).body, { type: "text", text: "after" });
  const context = await memory.context.set({ section: "temporary", content: "old", pinned: true }, p);
  await memory.context.update(context.id, { content: "new" }, p);
  assert.match(await create().context.render(), /new/);
  await memory.context.set({ section: "expired", content: "expired", pinned: true, expiresAt: "2000-01-01T00:00:00Z" }, p);
  assert.deepEqual(await create().context.list("expired"), []);
  await memory.context.unset(context.id, p);
  await memory.entity.disconnect(edge.id, p);
  await memory.episodic.deleteEpisode(episode.id, p);
  await memory.resources.remove("/notes/b", false, p);
  assert.equal((await create().entity.getNodeWithNeighbours(keep.id))?.neighbours.length, 0);
  assert.deepEqual(await create().episodic.findEpisodes({}), []);
  assert.equal(await create().resources.exists("/notes/b"), false);
  assert.deepEqual(await create().context.list(), []);
});

test("failed and over-limit mutations roll back the whole method, including prior bulk changes", async t => {
  const { file, create } = await fixture(t);
  const memory = create();
  await memory.context.set({ section: "preferences", content: "keep me", pinned: true }, p);
  const bounded = createSqliteMemoryAdapters({ file, namespace: "owner", schema, maxSnapshotBytes: 1024 });
  await assert.rejects(bounded.context.setSection("preferences", [
    { content: "new first", pinned: true },
    { content: "x".repeat(3000), pinned: true },
  ], p), /rolled back/);
  assert.equal((await memory.context.list("preferences"))[0]?.content, "keep me");
  const person = await memory.entity.addNode("Person", { name: "Mira" }, p);
  await assert.rejects(memory.entity.updateNode(person.id, { name: 42 }, p));
  assert.equal((await memory.entity.getNode(person.id))?.props.name, "Mira");
});

test("embeddings and invalidation survive reconstruction", async t => {
  const { file } = await fixture(t);
  const embedder = { dimensions: 2, async embed(texts: string[]) { return texts.map(() => [1, 0]); } };
  const create = () => createSqliteMemoryAdapters({ file, namespace: "vector", schema, embedder });
  const memory = create();
  const episode = await memory.episodic.recordEpisode({ kind: "lesson", content: "indexed", occurredAt: p.timestamp, participants: [] }, p);
  await memory.episodic.setEmbedding(episode.id, [1, 0]);
  await memory.resources.write("/notes/indexed", { type: "text", text: "indexed" }, { tags: [], links: [] }, p);
  await memory.resources.setEmbedding!("/notes/indexed", [1, 0]);
  assert.equal((await create().episodic.searchEpisodes!("indexed"))[0]?.episode.id, episode.id);
  assert.equal((await create().resources.searchSemantic!("indexed"))[0]?.path, "/notes/indexed");
  await memory.episodic.updateEpisode(episode.id, { content: "changed" }, p);
  await memory.resources.edit("/notes/indexed", "indexed", "changed", p);
  assert.deepEqual(await create().episodic.searchEpisodes!("indexed"), []);
  assert.deepEqual(await create().resources.searchSemantic!("indexed"), []);
  assert.equal((await create().episodic.findEpisodesNeedingEmbedding())[0]?.id, episode.id);
  assert.equal((await create().resources.findFilesNeedingEmbedding!())[0]?.path, "/notes/indexed");
});

test("corrupt or newer state fails closed without deleting saved data", async t => {
  const { file, create } = await fixture(t);
  const memory = create();
  await memory.context.set({ section: "saved", content: "retain", pinned: true }, p);
  const db = new DatabaseSync(file);
  db.prepare("UPDATE glove_memory_state SET version = 2").run();
  db.close();
  await assert.rejects(memory.context.list(), MemoryStorageError);
  await assert.rejects(memory.context.set({ section: "saved", content: "replace", pinned: true }, p), MemoryStorageError);
  const restored = new DatabaseSync(file);
  restored.prepare("UPDATE glove_memory_state SET version = 1").run();
  restored.close();
  assert.equal((await memory.context.list())[0]?.content, "retain");
  const corrupted = new DatabaseSync(file);
  corrupted.prepare("UPDATE glove_memory_state SET state = ?").run(serialize({ entries: [], nextId: -1 }));
  corrupted.close();
  await assert.rejects(memory.context.list(), /invalid/);
});

test("database is private and refuses symlink or in-memory targets", async t => {
  const { directory, file } = await fixture(t);
  assert.throws(() => createSqliteMemoryAdapters({ file: ":memory:", namespace: "owner", schema }));
  assert.throws(() => createSqliteMemoryAdapters({ file, namespace: "", schema }));
  const target = join(directory, "unrelated.txt");
  await writeFile(target, "must not change");
  const link = join(directory, "linked.sqlite");
  await symlink(target, link);
  assert.throws(() => createSqliteMemoryAdapters({ file: link, namespace: "owner", schema }));
  assert.equal(await readFile(target, "utf8"), "must not change");
});

test("a killed writer rolls back and releases the database for the next worker", async t => {
  const { file, create } = await fixture(t);
  await worker("write", file);
  const child = fork(fileURLToPath(new URL("./fixtures/sqlite-worker.ts", import.meta.url)), ["uncommitted", file, "owner"], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const ready = once(child, "message", { signal: AbortSignal.timeout(10_000) });
  assert.equal((await ready)[0], "locked");
  const exit = once(child, "exit");
  child.kill("SIGKILL");
  await exit;
  assert.equal((await create().context.list())[0]?.content, "Cobalt is preferred");
  await create().context.set({ section: "recovery", content: "writer recovered", pinned: false }, p);
  assert.equal((await create().context.list("recovery")).length, 1);
});

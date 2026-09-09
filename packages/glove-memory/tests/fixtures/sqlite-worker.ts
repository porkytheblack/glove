import { createSqliteMemoryAdapters } from "../../src/sqlite/index";
import { MemorySchema } from "../../src/core/schema";
import { z } from "zod";
import { DatabaseSync } from "node:sqlite";

export const schema = new MemorySchema()
  .defineNodeClass({ name: "Person", schema: z.object({ name: z.string(), notes: z.string().optional(), extra: z.unknown().optional() }), identityKeys: [["name"]], searchableProperties: ["name", "notes"] })
  .defineNodeClass({ name: "Project", schema: z.object({ name: z.string() }), identityKeys: [["name"]] })
  .defineRelationship({ type: "worksOn", from: "Person", to: "Project" })
  .defineEpisodeKind({ name: "lesson" })
  .defineResourceRoot({ path: "/notes" });
export const provenance = { source: "test", actor: "test-worker", timestamp: "2026-09-08T00:00:00.000Z" };

const [mode, file, namespace, workerId] = process.argv.slice(2);
if (mode && file && namespace) {
  const memory = createSqliteMemoryAdapters({ file, namespace, schema, fuzzySearch: true, busyTimeoutMs: 15_000 });
  if (mode === "write") {
    const person = await memory.entity.addNode("Person", { name: "Mira", notes: "Prefers cobalt" }, provenance);
    const project = await memory.entity.addNode("Project", { name: "Atlas" }, provenance);
    const edge = await memory.entity.connect(person.id, project.id, "worksOn", undefined, provenance);
    const episode = await memory.episodic.recordEpisode({ kind: "lesson", content: "Cobalt launch decision", occurredAt: provenance.timestamp, participants: [{ entityId: person.id }] }, provenance);
    await memory.resources.mkdir("/notes/empty", provenance);
    await memory.resources.write("/notes/launch.md", { type: "markdown", text: Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n") }, { tags: ["launch"], links: [{ kind: "entity", id: person.id }] }, provenance);
    const context = await memory.context.set({ section: "preferences", content: "Cobalt is preferred", pinned: true }, provenance);
    console.log(JSON.stringify({ person, project, edge, episode, context }));
  } else if (mode === "read") {
    console.log(JSON.stringify({
      people: await memory.entity.findNodes("Person", {}),
      episodes: await memory.episodic.findEpisodes({}),
      file: await memory.resources.read("/notes/launch.md", { range: [1, -1] }),
      directories: await memory.resources.list("/notes"),
      context: await memory.context.list(),
      prompt: await memory.context.render(),
    }));
  } else if (mode === "append") {
    for (let index = 0; index < 10; index++) {
      await memory.entity.addNode("Person", { name: "Shared identity" }, provenance);
      await memory.episodic.recordEpisode({ kind: "lesson", content: `${workerId}:${index}`, occurredAt: provenance.timestamp, participants: [] }, provenance);
    }
    console.log("ok");
  } else if (mode === "uncommitted") {
    const db = new DatabaseSync(file);
    db.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
    db.prepare("UPDATE glove_memory_state SET version = 999 WHERE namespace = ?").run(namespace);
    process.send?.("locked");
    setInterval(() => undefined, 1000);
  } else { throw new Error("Unknown fixture mode"); }
}

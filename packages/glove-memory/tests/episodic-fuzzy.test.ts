/** Embedding-free fuzzy (lexical) search over episodic content. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySchema } from "../src/core/schema";
import { InMemoryEpisodicAdapter } from "../src/in-memory/episodic";
import { buildEpisodicReaderTools } from "../src/tools/episodic/index";

const schema = new MemorySchema().defineEpisodeKind({ name: "note", description: "A note." });
const prov = { source: "manual", actor: "test", timestamp: "2024-01-01T00:00:00.000Z" };
const OLD = "2023-01-01T00:00:00.000Z";
const RECENT = "2025-06-01T00:00:00.000Z";

async function seeded() {
  const ep = new InMemoryEpisodicAdapter({ schema, fuzzySearch: true });
  const a = await ep.recordEpisode(
    { occurredAt: OLD, content: "Discussed the regulatory licensing approach with the compliance team", kind: "note", participants: [{ entityId: "e-compliance" }] },
    prov,
  );
  const b = await ep.recordEpisode(
    { occurredAt: OLD, content: "Reviewed the Q3 marketing budget and ad spend", kind: "note", participants: [{ entityId: "e-marketing" }] },
    prov,
  );
  const c = await ep.recordEpisode(
    { occurredAt: RECENT, content: "Planned the database migration to Postgres", kind: "note", participants: [{ entityId: "e-eng" }] },
    prov,
  );
  const d = await ep.recordEpisode(
    { occurredAt: RECENT, content: "Talked about licensing and compliance requirements for the new market", kind: "note", participants: [{ entityId: "e-compliance" }] },
    prov,
  );
  return { ep, a: a.id, b: b.id, c: c.id, d: d.id };
}

test("fuzzySearch enables searchEpisodes and registers the search tool", () => {
  const ep = new InMemoryEpisodicAdapter({ schema, fuzzySearch: true });
  assert.equal(ep.supportsSemanticSearch, true);
  const tools = buildEpisodicReaderTools(ep).map((t) => t.name);
  assert.ok(tools.includes("glove_episodic_search"));
});

test("no embedder and no fuzzy → content search is disabled", async () => {
  const ep = new InMemoryEpisodicAdapter({ schema });
  assert.equal(ep.supportsSemanticSearch, false);
  const tools = buildEpisodicReaderTools(ep).map((t) => t.name);
  assert.ok(!tools.includes("glove_episodic_search"));
  assert.ok(tools.includes("glove_episodic_find") && tools.includes("glove_episodic_timeline"));
  await assert.rejects(() => ep.searchEpisodes!("anything"));
});

test("fuzzy content search matches relevant episodes and excludes others", async () => {
  const { ep, a, b, d } = await seeded();
  const ids = (await ep.searchEpisodes("licensing compliance", { limit: 10 })).map((r) => r.episode.id);
  assert.ok(ids.includes(a) && ids.includes(d), "both licensing episodes present");
  assert.ok(!ids.includes(b), "unrelated marketing episode excluded");
});

test("exact phrase scores 1 and ranks first", async () => {
  const { ep, a } = await seeded();
  const results = await ep.searchEpisodes("regulatory licensing approach", { recencyWeight: 0, limit: 5 });
  assert.equal(results[0]?.episode.id, a);
  assert.ok(Math.abs((results[0]?.score ?? 0) - 1) < 1e-9);
});

test("typos still match via bigram-Dice fallback", async () => {
  const { ep, a, d } = await seeded();
  const ids = (await ep.searchEpisodes("licencing complaince", { recencyWeight: 0, limit: 5 })).map((r) => r.episode.id);
  assert.ok(ids.includes(a) || ids.includes(d));
});

test("irrelevant query returns nothing (similarity floor excludes noise)", async () => {
  const { ep } = await seeded();
  assert.equal((await ep.searchEpisodes("quantum chromodynamics", { limit: 5 })).length, 0);
});

test("recency bias promotes the recent match", async () => {
  const { ep, d } = await seeded();
  const results = await ep.searchEpisodes("licensing compliance", { recencyWeight: 1, limit: 10 });
  assert.equal(results[0]?.episode.id, d);
});

test("structural filters apply before ranking", async () => {
  const { ep, a, d } = await seeded();
  const byParticipant = await ep.searchEpisodes("licensing compliance", { filter: { participantIds: ["e-compliance"] }, limit: 10 });
  assert.deepEqual(byParticipant.map((r) => r.episode.id).sort(), [a, d].sort());

  const byTime = await ep.searchEpisodes("licensing compliance", { filter: { timeRange: { start: "2024-01-01T00:00:00.000Z" } }, limit: 10 });
  const ids = byTime.map((r) => r.episode.id);
  assert.ok(ids.includes(d) && !ids.includes(a));
});

test("embedder takes precedence over fuzzySearch", async () => {
  const embedder = { dimensions: 3, async embed(texts: string[]) { return texts.map(() => [1, 0, 0]); } };
  const ep = new InMemoryEpisodicAdapter({ schema, embedder, fuzzySearch: true });
  assert.equal(ep.supportsSemanticSearch, true);
  // Vector mode ignores content until an embed pass runs, so an un-embedded
  // episode is not a candidate — proving fuzzy mode did NOT take over.
  await ep.recordEpisode({ occurredAt: RECENT, content: "licensing compliance", kind: "note", participants: [] }, prov);
  assert.equal((await ep.searchEpisodes("licensing")).length, 0);
});

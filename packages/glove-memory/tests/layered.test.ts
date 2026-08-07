/** Layered memory — a shared read-only stratum merged with a private writable one. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { MemorySchema } from "../src/core/schema";
import { MemoryLayerError, MemoryNotFoundError } from "../src/core/errors";
import { InMemoryContextAdapter } from "../src/in-memory/context";
import { InMemoryEntityAdapter } from "../src/in-memory/entity";
import { InMemoryEpisodicAdapter } from "../src/in-memory/episodic";
import { InMemoryResourcesAdapter } from "../src/in-memory/resources";
import {
  layerContext,
  layerEntity,
  layerEpisodic,
  layerResources,
} from "../src/layered/index";
import { buildResourcesCuratorTools } from "../src/tools/resources/index";

const schema = new MemorySchema()
  .defineNodeClass({
    name: "Organization",
    schema: z.object({ name: z.string(), domain: z.string().optional() }),
    identityKeys: [["domain"], ["name"]],
    searchableProperties: ["name"],
  })
  .defineNodeClass({
    name: "Person",
    schema: z.object({ name: z.string(), email: z.string().optional() }),
    identityKeys: [["email"], ["name"]],
    searchableProperties: ["name"],
  })
  .defineRelationship({ type: "worksAt", from: "Person", to: "Organization" })
  .defineEpisodeKind({ name: "note" })
  .defineResourceRoot({ path: "/handbook", description: "Org handbook. Read-only." })
  .defineResourceRoot({ path: "/notes", description: "The agent's own notes." });

const prov = { source: "manual", actor: "test", timestamp: "2026-01-01T00:00:00.000Z" };
const meta = { tags: [], links: [] };

// ─── Stack validation ─────────────────────────────────────────────────────

test("a layer stack needs exactly one writable stratum", () => {
  const a = new InMemoryContextAdapter({ schema });
  const b = new InMemoryContextAdapter({ schema });

  assert.throws(() => layerContext([]), (e: unknown) => {
    assert.ok(e instanceof MemoryLayerError);
    assert.equal(e.code, "layer_config");
    return true;
  });

  assert.throws(
    () => layerContext([{ name: "shared", adapter: a, access: "read" }]),
    (e: unknown) => {
      assert.ok(e instanceof MemoryLayerError);
      assert.match(e.message, /no layer has access "write"/);
      return true;
    },
  );

  assert.throws(
    () =>
      layerContext([
        { name: "one", adapter: a, access: "write" },
        { name: "two", adapter: b, access: "write" },
      ]),
    (e: unknown) => {
      assert.ok(e instanceof MemoryLayerError);
      assert.match(e.message, /2 layers have access "write"/);
      return true;
    },
  );

  assert.throws(
    () =>
      layerContext([
        { name: "same", adapter: a, access: "read" },
        { name: "same", adapter: b, access: "write" },
      ]),
    (e: unknown) => {
      assert.ok(e instanceof MemoryLayerError);
      assert.match(e.message, /duplicate layer name/);
      return true;
    },
  );
});

// ─── Resources: mounted strata ────────────────────────────────────────────

async function mountedResources() {
  const sharedFs = new InMemoryResourcesAdapter({ schema, identifier: "shared" });
  const privateFs = new InMemoryResourcesAdapter({ schema, identifier: "private" });
  await sharedFs.write("/handbook/pay.md", { type: "markdown", text: "pay review policy" }, meta, prov);
  await sharedFs.write("/handbook/leave/policy.md", { type: "markdown", text: "leave policy detail" }, meta, prov);
  // Deliberately outside the mount — must never surface through the layer.
  await sharedFs.write("/scratch/leaked.md", { type: "markdown", text: "pay leak" }, meta, prov);
  await privateFs.write("/notes/todo.md", { type: "markdown", text: "ask about pay review" }, meta, prov);

  const fs = layerResources([
    { name: "handbook", adapter: sharedFs, access: "read", paths: ["/handbook"] },
    { name: "notes", adapter: privateFs, access: "write" },
  ]);
  return { sharedFs, privateFs, fs };
}

test("mounted strata present as one tree", async () => {
  const { fs } = await mountedResources();

  const root = await fs.list("/");
  assert.deepEqual(root.map((e) => e.path).sort(), ["/handbook", "/notes"]);

  const handbook = await fs.list("/handbook");
  assert.deepEqual(handbook.map((e) => e.path).sort(), ["/handbook/leave", "/handbook/pay.md"]);

  const file = await fs.read("/handbook/pay.md");
  assert.equal((file.body as { text: string }).text, "pay review policy");

  assert.equal(await fs.layerOf("/handbook/pay.md"), "handbook");
  assert.equal(await fs.layerOf("/notes/todo.md"), "notes");
  assert.equal(await fs.layerOf("/nope.md"), null);
});

test("a stratum never leaks paths outside the prefix it was mounted at", async () => {
  const { fs } = await mountedResources();

  const root = await fs.list("/");
  assert.equal(root.some((e) => e.path === "/scratch"), false);
  assert.equal(await fs.exists("/scratch/leaked.md"), false);
  assert.equal((await fs.glob("/**/*.md")).some((p) => p.startsWith("/scratch")), false);
  assert.equal((await fs.grep({ query: "pay" })).some((m) => m.path.startsWith("/scratch")), false);
});

test("search spans both strata", async () => {
  const { fs } = await mountedResources();

  const hits = await fs.grep({ query: "pay" });
  assert.deepEqual(
    [...new Set(hits.map((h) => h.path))].sort(),
    ["/handbook/pay.md", "/notes/todo.md"],
  );

  const globbed = await fs.glob("/**/*.md");
  assert.deepEqual(globbed.sort(), [
    "/handbook/leave/policy.md",
    "/handbook/pay.md",
    "/notes/todo.md",
  ]);
});

test("every mutation into the shared stratum is refused, and names it", async () => {
  const { sharedFs, fs } = await mountedResources();

  const denied: Array<[string, () => Promise<unknown>]> = [
    ["write", () => fs.write("/handbook/new.md", { type: "text", text: "x" }, meta, prov)],
    ["edit", () => fs.edit("/handbook/pay.md", "pay", "PAY", prov)],
    ["mkdir", () => fs.mkdir("/handbook/sub", prov)],
    ["remove", () => fs.remove("/handbook/pay.md", false, prov)],
    ["setMetadata", () => fs.setMetadata("/handbook/pay.md", { summary: "s" }, prov)],
  ];

  for (const [label, call] of denied) {
    await assert.rejects(call, (e: unknown) => {
      assert.ok(e instanceof MemoryLayerError, `${label} threw ${String(e)}`);
      assert.equal(e.code, "layer_read_only");
      assert.equal(e.layer, "handbook");
      assert.match(e.message, /read-only layer "handbook"/);
      return true;
    });
  }

  const untouched = await sharedFs.read("/handbook/pay.md");
  assert.equal((untouched.body as { text: string }).text, "pay review policy");
  assert.equal(await sharedFs.exists("/handbook/new.md"), false);
});

test("writes land in the private stratum", async () => {
  const { privateFs, fs } = await mountedResources();

  await fs.write("/notes/fresh.md", { type: "text", text: "mine" }, meta, prov);
  assert.equal(await privateFs.exists("/notes/fresh.md"), true);
  assert.equal(await fs.layerOf("/notes/fresh.md"), "notes");

  await fs.edit("/notes/todo.md", "ask", "asked", prov);
  const edited = await fs.read("/notes/todo.md");
  assert.match((edited.body as { text: string }).text, /^asked/);
});

test("moving across strata is refused rather than half-completed", async () => {
  const { fs } = await mountedResources();
  await assert.rejects(
    () => fs.move("/notes/todo.md", "/handbook/todo.md", prov),
    (e: unknown) => {
      assert.ok(e instanceof MemoryLayerError);
      // The destination is read-only, so that refusal fires before the
      // cross-layer one — either way the move never half-lands.
      assert.equal(e.code, "layer_read_only");
      return true;
    },
  );
});

test("a recursive remove that would reach a shared stratum is refused", async () => {
  const { privateFs, fs } = await mountedResources();

  await assert.rejects(() => fs.remove("/", true, prov), (e: unknown) => {
    assert.ok(e instanceof MemoryLayerError);
    assert.equal(e.layer, "handbook");
    return true;
  });

  await fs.remove("/notes", true, prov);
  assert.equal(await privateFs.exists("/notes/todo.md"), false);
});

test("listing a path only one stratum has still works", async () => {
  const { fs } = await mountedResources();
  // `/handbook` exists in the shared adapter only; the private one throws
  // path_not_found for it, which must not take the listing down.
  const entries = await fs.list("/handbook/leave");
  assert.deepEqual(entries.map((e) => e.path), ["/handbook/leave/policy.md"]);

  // A path no stratum has still errors.
  await assert.rejects(() => fs.list("/nowhere"), /not found/i);
});

// ─── Resources: union strata (both span the whole tree) ───────────────────

test("union strata: private shadows shared, reads fall through", async () => {
  const sharedFs = new InMemoryResourcesAdapter({ schema, identifier: "shared" });
  const privateFs = new InMemoryResourcesAdapter({ schema, identifier: "private" });
  await sharedFs.write("/doc.md", { type: "markdown", text: "shared version" }, meta, prov);
  await sharedFs.write("/only-shared.md", { type: "markdown", text: "shared only" }, meta, prov);
  await privateFs.write("/doc.md", { type: "markdown", text: "private version" }, meta, prov);

  const fs = layerResources([
    { name: "private", adapter: privateFs, access: "write" },
    { name: "shared", adapter: sharedFs, access: "read" },
  ]);

  // Earlier layer wins the collision.
  assert.equal(((await fs.read("/doc.md")).body as { text: string }).text, "private version");
  assert.equal(await fs.layerOf("/doc.md"), "private");
  // And falls through for what only the shared stratum has.
  assert.equal(((await fs.read("/only-shared.md")).body as { text: string }).text, "shared only");

  const root = await fs.list("/");
  assert.deepEqual(root.map((e) => e.path).sort(), ["/doc.md", "/only-shared.md"]);

  // Writing a path only the shared stratum holds is refused as read-only —
  // NOT routed into the private store as a silent shadow copy.
  await assert.rejects(
    () => fs.write("/only-shared.md", { type: "text", text: "fork" }, meta, prov),
    (e: unknown) => {
      assert.ok(e instanceof MemoryLayerError);
      assert.equal(e.code, "layer_read_only");
      assert.equal(e.layer, "shared");
      return true;
    },
  );

  // A brand-new path lands in the private stratum.
  await fs.write("/new.md", { type: "text", text: "mine" }, meta, prov);
  assert.equal(await privateFs.exists("/new.md"), true);
  assert.equal(await sharedFs.exists("/new.md"), false);
});

// ─── Episodic ─────────────────────────────────────────────────────────────

async function layeredEpisodic() {
  const sharedEp = new InMemoryEpisodicAdapter({ schema, identifier: "shared" });
  const privateEp = new InMemoryEpisodicAdapter({ schema, identifier: "private", fuzzySearch: true });
  const a = await sharedEp.recordEpisode(
    { occurredAt: "2026-01-10T00:00:00.000Z", content: "All-hands on the pay review", kind: "note", participants: [{ entityId: "org-1" }] },
    prov,
  );
  const b = await privateEp.recordEpisode(
    { occurredAt: "2026-02-10T00:00:00.000Z", content: "I asked about the pay review", kind: "note", participants: [{ entityId: "org-1" }] },
    prov,
  );
  const c = await sharedEp.recordEpisode(
    { occurredAt: "2026-03-10T00:00:00.000Z", content: "Policy published", kind: "note", participants: [] },
    prov,
  );
  const ep = layerEpisodic([
    { name: "org", adapter: sharedEp, access: "read" },
    { name: "mine", adapter: privateEp, access: "write" },
  ]);
  return { sharedEp, privateEp, ep, ids: { a: a.id, b: b.id, c: c.id } };
}

test("the timeline interleaves strata in true chronological order", async () => {
  const { ep, ids } = await layeredEpisodic();

  const all = await ep.findEpisodes({});
  assert.deepEqual(all.map((e) => e.id), [ids.c, ids.b, ids.a]);

  const asc = await ep.findEpisodes({ orderBy: "occurredAt:asc" });
  assert.deepEqual(asc.map((e) => e.id), [ids.a, ids.b, ids.c]);

  // The window applies to the merged list, not per stratum.
  assert.deepEqual((await ep.findEpisodes({ limit: 2 })).map((e) => e.id), [ids.c, ids.b]);
  assert.deepEqual(
    (await ep.findEpisodes({ limit: 2, offset: 1 })).map((e) => e.id),
    [ids.b, ids.a],
  );

  // Participants cross strata freely — nothing validates the entity id.
  const forOrg = await ep.episodesForEntity("org-1");
  assert.deepEqual(forOrg.map((e) => e.id), [ids.b, ids.a]);

  const between = await ep.episodesBetween("2026-01-01T00:00:00.000Z", "2026-02-28T00:00:00.000Z");
  assert.deepEqual(between.map((e) => e.id), [ids.b, ids.a]);
});

test("episodic writes land privately; shared episodes are immutable", async () => {
  const { privateEp, ep, ids } = await layeredEpisodic();

  const fresh = await ep.recordEpisode(
    { occurredAt: "2026-04-01T00:00:00.000Z", content: "my own note", kind: "note", participants: [] },
    prov,
  );
  assert.ok(await privateEp.getEpisode(fresh.id));

  await ep.updateEpisode(ids.b, { content: "revised" }, prov);
  assert.equal((await ep.getEpisode(ids.b))?.content, "revised");

  for (const call of [
    () => ep.updateEpisode(ids.a, { content: "nope" }, prov),
    () => ep.deleteEpisode(ids.a, prov),
  ]) {
    await assert.rejects(call, (e: unknown) => {
      assert.ok(e instanceof MemoryLayerError);
      assert.equal(e.code, "layer_read_only");
      assert.equal(e.layer, "org");
      return true;
    });
  }
});

test("semantic search is advertised when any stratum supports it", async () => {
  const { ep } = await layeredEpisodic();
  assert.equal(ep.supportsSemanticSearch, true);
  assert.equal(typeof ep.searchEpisodes, "function");

  // Only the fuzzy-capable private stratum answers, so shared episodes are
  // absent from search while still present in find/timeline.
  const hits = await ep.searchEpisodes!("pay review");
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.episode.content.startsWith("I asked")));

  const noSearch = layerEpisodic([
    { name: "a", adapter: new InMemoryEpisodicAdapter({ schema }), access: "read" },
    { name: "b", adapter: new InMemoryEpisodicAdapter({ schema }), access: "write" },
  ]);
  assert.equal(noSearch.supportsSemanticSearch, false);
  assert.equal(noSearch.searchEpisodes, undefined);
});

// ─── Entity ───────────────────────────────────────────────────────────────

async function layeredEntity() {
  const sharedEnt = new InMemoryEntityAdapter({ schema, identifier: "shared" });
  const privateEnt = new InMemoryEntityAdapter({ schema, identifier: "private" });
  const acme = await sharedEnt.addNode("Organization", { name: "Acme", domain: "acme.com" }, prov);
  const me = await privateEnt.addNode("Person", { name: "Don", email: "don@example.com" }, prov);
  const ent = layerEntity([
    { name: "ontology", adapter: sharedEnt, access: "read" },
    { name: "private", adapter: privateEnt, access: "write" },
  ]);
  return { sharedEnt, privateEnt, ent, acmeId: acme.id, meId: me.id };
}

test("the graph reads as one across strata", async () => {
  const { ent, acmeId, meId } = await layeredEntity();

  assert.equal((await ent.getNode(acmeId))?.props.name, "Acme");
  assert.equal((await ent.getNode(meId))?.props.name, "Don");
  assert.equal(await ent.layerOf(acmeId), "ontology");
  assert.equal(await ent.layerOf(meId), "private");

  const orgs = await ent.findNodes("Organization", {});
  assert.deepEqual(orgs.map((n) => n.id), [acmeId]);

  const rows = (await ent.query({ from: "Person" })).rows;
  assert.deepEqual(rows.map((r) => r.id), [meId]);
});

test("addNode resolves identity against the shared stratum instead of forking it", async () => {
  const { privateEnt, ent, acmeId } = await layeredEntity();

  // Same domain → the shared node, not a private duplicate.
  const hit = await ent.addNode("Organization", { name: "Acme Corporation", domain: "acme.com" }, prov);
  assert.equal(hit.id, acmeId);
  assert.equal(hit.created, false);
  assert.equal((await privateEnt.findNodes("Organization", {})).length, 0);

  // A genuinely new organisation goes private.
  const fresh = await ent.addNode("Organization", { name: "Initech", domain: "initech.com" }, prov);
  assert.equal(fresh.created, true);
  assert.equal(await ent.layerOf(fresh.id), "private");

  // Both are visible in one find.
  const orgs = await ent.findNodes("Organization", {});
  assert.deepEqual(orgs.map((n) => n.props.name).sort(), ["Acme", "Initech"]);
});

test("shared nodes are immutable through the layered view", async () => {
  const { ent, acmeId, meId } = await layeredEntity();

  for (const call of [
    () => ent.updateNode(acmeId, { name: "Renamed" }, prov),
    () => ent.mergeNodes(acmeId, meId, prov),
  ]) {
    await assert.rejects(call, (e: unknown) => {
      assert.ok(e instanceof MemoryLayerError);
      assert.equal(e.code, "layer_read_only");
      assert.equal(e.layer, "ontology");
      return true;
    });
  }

  await ent.updateNode(meId, { name: "Donald" }, prov);
  assert.equal((await ent.getNode(meId))?.props.name, "Donald");
});

test("an edge that would straddle strata is refused with the reason", async () => {
  const { ent, acmeId, meId } = await layeredEntity();

  await assert.rejects(
    () => ent.connect(meId, acmeId, "worksAt", undefined, prov),
    (e: unknown) => {
      assert.ok(e instanceof MemoryLayerError);
      assert.equal(e.code, "cross_layer_unsupported");
      assert.match(e.message, /neither store holds both endpoints/);
      assert.match(e.message, /episode participant or a resource link/);
      return true;
    },
  );

  await assert.rejects(
    () => ent.connect(meId, "missing", "worksAt", undefined, prov),
    MemoryNotFoundError,
  );
});

test("edges within the private stratum work normally", async () => {
  const { ent, privateEnt } = await layeredEntity();
  const org = await ent.addNode("Organization", { name: "Initech", domain: "initech.com" }, prov);
  const person = await ent.addNode("Person", { name: "Milton", email: "m@initech.com" }, prov);

  const edge = await ent.connect(person.id, org.id, "worksAt", undefined, prov);
  assert.equal(edge.created, true);

  const hood = await ent.getNodeWithNeighbours(person.id);
  assert.deepEqual(hood?.neighbours.map((n) => n.nodeId), [org.id]);

  await ent.disconnect(edge.id, prov);
  assert.deepEqual((await privateEnt.getNodeWithNeighbours(person.id))?.neighbours, []);
});

test("disconnecting an unknown edge explains the read-only possibility", async () => {
  const { ent } = await layeredEntity();
  await assert.rejects(() => ent.disconnect("edge_nope", prov), (e: unknown) => {
    assert.ok(e instanceof MemoryLayerError);
    assert.equal(e.code, "layer_read_only");
    assert.match(e.message, /read-only layer/);
    return true;
  });
});

// ─── Context ──────────────────────────────────────────────────────────────

test("context merges, renders shared-first, and keeps shared entries immutable", async () => {
  const orgCtx = new InMemoryContextAdapter({ schema, identifier: "org" });
  const userCtx = new InMemoryContextAdapter({ schema, identifier: "user" });
  const shared = await orgCtx.set(
    { section: "policy", title: "Tone", content: "Always cite the handbook.", pinned: true },
    prov,
  );
  const mine = await userCtx.set(
    { section: "preferences", title: "Format", content: "Bullet points, please.", pinned: true },
    prov,
  );

  const ctx = layerContext([
    { name: "org", adapter: orgCtx, access: "read" },
    { name: "user", adapter: userCtx, access: "write" },
  ]);

  const listed = await ctx.list();
  assert.deepEqual(listed.map((e) => e.id).sort(), [shared.id, mine.id].sort());
  assert.equal((await ctx.get(shared.id))?.title, "Tone");
  assert.equal(await ctx.layerOf(shared.id), "org");

  const rendered = await ctx.render();
  assert.match(rendered, /Always cite the handbook/);
  assert.match(rendered, /Bullet points/);
  assert.ok(
    rendered.indexOf("Always cite the handbook") < rendered.indexOf("Bullet points"),
    "shared context should render before private context",
  );

  const added = await ctx.set({ section: "preferences", content: "Metric units.", pinned: true }, prov);
  assert.equal(await ctx.layerOf(added.id), "user");
  await ctx.update(mine.id, { content: "Numbered lists." }, prov);
  assert.equal((await ctx.get(mine.id))?.content, "Numbered lists.");

  for (const call of [
    () => ctx.update(shared.id, { content: "nope" }, prov),
    () => ctx.unset(shared.id, prov),
  ]) {
    await assert.rejects(call, (e: unknown) => {
      assert.ok(e instanceof MemoryLayerError);
      assert.equal(e.code, "layer_read_only");
      assert.equal(e.layer, "org");
      return true;
    });
  }

  // A shared entry in the same section survives a section replace.
  await ctx.setSection("policy", [{ content: "My own policy note.", pinned: true }], prov);
  assert.equal((await ctx.get(shared.id))?.content, "Always cite the handbook.");
});

// ─── Through the tool surface ─────────────────────────────────────────────

test("the ordinary tool surface folds over a layered adapter and refuses correctly", async () => {
  const { fs } = await mountedResources();
  const tools = buildResourcesCuratorTools(fs);

  const write = tools.find((t) => t.name === "glove_resources_write")!;
  const refused = await write.do(
    { path: "/handbook/new.md", body: { type: "text", text: "x" } },
    undefined as never,
    undefined as never,
  );
  assert.equal(refused.status, "error");
  assert.deepEqual(refused.data, { code: "layer_read_only" });
  assert.match(refused.message ?? "", /read-only layer "handbook"/);

  const allowed = await write.do(
    { path: "/notes/from-tool.md", body: { type: "text", text: "x" } },
    undefined as never,
    undefined as never,
  );
  assert.equal(allowed.status, "success");

  // Reads see both strata through the tool surface too.
  const ls = tools.find((t) => t.name === "glove_resources_ls")!;
  const listed = await ls.do({ path: "/" }, undefined as never, undefined as never);
  assert.deepEqual(
    (listed.data as { entries: Array<{ path: string }> }).entries.map((e) => e.path).sort(),
    ["/handbook", "/notes"],
  );
});

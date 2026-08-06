/** Path-scoped access policies over the resources filesystem. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MemorySchema } from "../src/core/schema";
import { ResourceAccessError } from "../src/core/errors";
import { InMemoryResourcesAdapter } from "../src/in-memory/resources";
import {
  ResourceAccessControl,
  getResourceAccessControl,
  withResourceAccess,
  type ResourceAccessPolicy,
} from "../src/resources/access";
import type { ResourceFsAdapter } from "../src/resources/adapter";
import {
  buildResourcesCuratorTools,
  buildResourcesReaderTools,
} from "../src/tools/resources/index";

const schema = new MemorySchema()
  .defineResourceRoot({ path: "/research", description: "Read-only research corpus." })
  .defineResourceRoot({ path: "/notes", description: "Agent scratch space." });

const prov = { source: "manual", actor: "test", timestamp: "2026-01-01T00:00:00.000Z" };
const meta = { tags: [], links: [] };

async function seeded(policy: ResourceAccessPolicy) {
  const base = new InMemoryResourcesAdapter({ schema });
  await base.write("/research/licensing.md", { type: "markdown", text: "licensing rules apply" }, meta, prov);
  await base.write("/research/deep/nested.md", { type: "markdown", text: "nested licensing detail" }, meta, prov);
  await base.write("/notes/todo.md", { type: "markdown", text: "licensing follow-up" }, meta, prov);
  await base.write("/private/salary.md", { type: "markdown", text: "licensing of secrets" }, meta, prov);
  return { base, fs: withResourceAccess(base, policy) };
}

/** The headline case: a folder the agent reads but can never change. */
const readOnlyResearch: ResourceAccessPolicy = {
  rules: [{ path: "/research", access: "read", note: "curated upstream" }],
};

// ─── Mode resolution ──────────────────────────────────────────────────────

test("modeFor: default applies where no rule matches, last matching rule wins", () => {
  const control = new ResourceAccessControl({
    default: "none",
    rules: [
      { path: "/research", access: "read" },
      { path: "/research/scratch", access: "write" },
    ],
  });

  assert.equal(control.modeFor("/elsewhere"), "none");
  assert.equal(control.modeFor("/research"), "read");
  assert.equal(control.modeFor("/research/deep/nested.md"), "read");
  assert.equal(control.modeFor("/research/scratch/draft.md"), "write");
});

test("modeFor: glob rules match the same vocabulary as glove_resources_glob", () => {
  const control = new ResourceAccessControl({
    rules: [{ path: "/**/*.locked.md", access: "read" }],
  });

  assert.equal(control.modeFor("/notes/plan.locked.md"), "read");
  assert.equal(control.modeFor("/notes/plan.md"), "write");
});

test("unrestricted is true only when nothing is held back", () => {
  assert.equal(new ResourceAccessControl().unrestricted, true);
  assert.equal(new ResourceAccessControl({ default: "read" }).unrestricted, false);
  assert.equal(new ResourceAccessControl({ rules: [{ path: "/a", access: "read" }] }).unrestricted, false);
});

// ─── Reads stay open ──────────────────────────────────────────────────────

test("a read-only folder is still fully readable", async () => {
  const { fs } = await seeded(readOnlyResearch);

  const file = await fs.read("/research/licensing.md");
  assert.equal(file.body.type, "markdown");

  const stat = await fs.stat("/research/licensing.md");
  assert.equal(stat?.kind, "file");

  const entries = await fs.list("/research");
  assert.deepEqual(
    entries.map((e) => e.name).sort(),
    ["deep", "licensing.md"],
  );

  assert.equal(await fs.exists("/research/licensing.md"), true);
});

// ─── Writes are refused ───────────────────────────────────────────────────

test("every mutating call into a read-only folder is refused", async () => {
  const { base, fs } = await seeded(readOnlyResearch);

  const denied = [
    () => fs.write("/research/new.md", { type: "text", text: "x" }, meta, prov),
    () => fs.edit("/research/licensing.md", "licensing", "LICENSING", prov),
    () => fs.mkdir("/research/sub", prov),
    () => fs.move("/research/licensing.md", "/notes/licensing.md", prov),
    () => fs.remove("/research/licensing.md", false, prov),
    () => fs.setMetadata("/research/licensing.md", { summary: "s" }, prov),
  ];

  for (const call of denied) {
    await assert.rejects(call, (e: unknown) => {
      assert.ok(e instanceof ResourceAccessError);
      assert.equal(e.code, "access_denied");
      assert.equal(e.granted, "read");
      assert.equal(e.required, "write");
      return true;
    });
  }

  // Nothing leaked through to the underlying store.
  const file = await base.read("/research/licensing.md");
  assert.equal((file.body as { text: string }).text, "licensing rules apply");
  assert.equal(await base.exists("/research/new.md"), false);
});

test("moving a file *into* a read-only folder is refused", async () => {
  const { fs } = await seeded(readOnlyResearch);
  await assert.rejects(
    () => fs.move("/notes/todo.md", "/research/todo.md", prov),
    ResourceAccessError,
  );
});

test("writes outside the rules follow the default", async () => {
  const { fs } = await seeded(readOnlyResearch);
  await fs.write("/notes/fresh.md", { type: "text", text: "ok" }, meta, prov);
  assert.equal(await fs.exists("/notes/fresh.md"), true);
});

// ─── Hidden subtrees ──────────────────────────────────────────────────────

test('"none" hides a path from reads, listings, grep, glob and links', async () => {
  const { fs } = await seeded({ rules: [{ path: "/private", access: "none" }] });

  await assert.rejects(() => fs.read("/private/salary.md"), ResourceAccessError);
  await assert.rejects(() => fs.stat("/private/salary.md"), ResourceAccessError);
  assert.equal(await fs.exists("/private/salary.md"), false);

  const rootEntries = await fs.list("/", { recursive: true });
  assert.equal(rootEntries.some((e) => e.path.startsWith("/private")), false);

  const hits = await fs.grep({ query: "licensing" });
  assert.equal(hits.some((h) => h.path.startsWith("/private")), false);
  assert.ok(hits.length > 0);

  const globbed = await fs.glob("/**/*.md");
  assert.equal(globbed.some((p) => p.startsWith("/private")), false);
});

test("an allowlist policy still lets the agent walk down to what it may read", async () => {
  const { fs } = await seeded({
    default: "none",
    rules: [{ path: "/research/deep", access: "read" }],
  });

  // `/research` itself is "none", but it's on the way to a granted subtree,
  // so it stays listable — otherwise the grant would be unreachable.
  const root = await fs.list("/");
  assert.deepEqual(root.map((e) => e.name), ["research"]);

  const research = await fs.list("/research");
  assert.deepEqual(research.map((e) => e.name), ["deep"]);

  // Traversal is not read access: the files directly under it stay refused.
  await assert.rejects(() => fs.read("/research/licensing.md"), ResourceAccessError);
  const file = await fs.read("/research/deep/nested.md");
  assert.equal(file.path, "/research/deep/nested.md");
});

test("scoping a search to a hidden subtree is refused rather than silently empty", async () => {
  const { fs } = await seeded({ rules: [{ path: "/private", access: "none" }] });
  await assert.rejects(() => fs.grep({ query: "licensing", path: "/private" }), ResourceAccessError);
  await assert.rejects(() => fs.glob("*.md", { path: "/private" }), ResourceAccessError);
});

// ─── Recursive blast radius ───────────────────────────────────────────────

test("a recursive remove that would reach a protected subtree is refused", async () => {
  const { base, fs } = await seeded(readOnlyResearch);

  await assert.rejects(() => fs.remove("/", true, prov), ResourceAccessError);
  await assert.rejects(() => fs.remove("/research", true, prov), ResourceAccessError);

  // A subtree with nothing protected under it still removes.
  await fs.remove("/notes", true, prov);
  assert.equal(await base.exists("/notes/todo.md"), false);
  assert.equal(await base.exists("/research/licensing.md"), true);
});

test("moving a directory clears the same bar as a recursive remove", async () => {
  const { fs } = await seeded(readOnlyResearch);
  await assert.rejects(() => fs.move("/", "/archive", prov), ResourceAccessError);
});

test("under a restrictive default, a recursive remove needs a prefix write rule", async () => {
  const { base, fs } = await seeded({
    default: "read",
    rules: [{ path: "/notes", access: "write" }],
  });

  await fs.remove("/notes", true, prov);
  assert.equal(await base.exists("/notes/todo.md"), false);

  // A glob grant only covers the paths it happens to match, so it can't
  // authorise a whole-subtree delete.
  const globbed = withResourceAccess(base, {
    default: "read",
    rules: [{ path: "/scratch/*.md", access: "write" }],
  });
  await assert.rejects(() => globbed.remove("/scratch", true, prov), ResourceAccessError);
});

// ─── Bulk rewrite ─────────────────────────────────────────────────────────

test("replaceLinkTarget is refused under a restrictive policy, passed through otherwise", async () => {
  const { base } = await seeded(readOnlyResearch);

  const restricted = withResourceAccess(base, readOnlyResearch);
  await assert.rejects(
    () => restricted.replaceLinkTarget("entity", "a", "b", prov),
    ResourceAccessError,
  );

  const open = withResourceAccess(base, {});
  assert.deepEqual(await open.replaceLinkTarget("entity", "a", "b", prov), { updated: 0 });
});

// ─── Wiring ───────────────────────────────────────────────────────────────

test("the wrapper preserves adapter identity and optional-method presence", async () => {
  const base = new InMemoryResourcesAdapter({ schema });
  const fs = withResourceAccess(base, readOnlyResearch);

  assert.equal(fs.identifier, base.identifier);
  assert.equal(fs.schema, schema);
  assert.equal(fs.supportsSemanticSearch, false);
  // Optional methods mirror the wrapped adapter — present iff it has them.
  assert.equal(typeof fs.searchSemantic, typeof base.searchSemantic);
  const bare = withResourceAccess(
    { identifier: "bare", schema, supportsSemanticSearch: false } as ResourceFsAdapter,
    {},
  );
  assert.equal(bare.searchSemantic, undefined);
  assert.equal(bare.setEmbedding, undefined);
  assert.equal(bare.findFilesNeedingEmbedding, undefined);
  // No embedder, so the tool surface must not advertise search either way.
  assert.equal(
    buildResourcesReaderTools(fs).some((t) => t.name === "glove_resources_search"),
    false,
  );

  assert.ok(getResourceAccessControl(fs) instanceof ResourceAccessControl);
  assert.equal(getResourceAccessControl(base), undefined);
});

test("tool descriptions carry the policy so the model isn't guessing", async () => {
  const { fs } = await seeded(readOnlyResearch);
  const tools = buildResourcesCuratorTools(fs);

  const write = tools.find((t) => t.name === "glove_resources_write")!;
  assert.match(write.description, /Access policy \(enforced/);
  assert.match(write.description, /\/research — read-only \(writes are refused\) \(curated upstream\)/);
  assert.match(write.description, /everything else — read and write/);
  // The registered roots still render alongside it.
  assert.match(write.description, /Registered resource roots:/);

  const grep = tools.find((t) => t.name === "glove_resources_grep")!;
  assert.match(grep.description, /Access policy \(enforced/);

  // An unrestricted adapter says nothing extra.
  const open = buildResourcesCuratorTools(withResourceAccess(fs, {}));
  assert.equal(
    open.find((t) => t.name === "glove_resources_grep")!.description.includes("Access policy"),
    false,
  );

  // Opting out of the description doesn't opt out of enforcement.
  const quiet = withResourceAccess(fs, { ...readOnlyResearch, describe: false });
  assert.equal(
    buildResourcesCuratorTools(quiet)
      .find((t) => t.name === "glove_resources_write")!
      .description.includes("Access policy"),
    false,
  );
  await assert.rejects(
    () => quiet.write("/research/x.md", { type: "text", text: "x" }, meta, prov),
    ResourceAccessError,
  );
});

test("write tools refuse through the folded tool surface, not just the adapter", async () => {
  const { fs } = await seeded(readOnlyResearch);
  const tools = buildResourcesCuratorTools(fs);
  const write = tools.find((t) => t.name === "glove_resources_write")!;

  const result = await write.do(
    { path: "/research/new.md", body: { type: "text", text: "x" } },
    undefined as never,
    undefined as never,
  );
  assert.equal(result.status, "error");
  assert.match(result.message ?? "", /Access denied/);
  assert.deepEqual(result.data, { code: "access_denied" });
});

test("policies stack — wrapping a wrapped adapter narrows further", async () => {
  const { fs } = await seeded(readOnlyResearch);
  const narrower: ResourceFsAdapter = withResourceAccess(fs, {
    rules: [{ path: "/notes", access: "read" }],
  });

  // The outer policy adds /notes; the inner one still holds /research.
  await assert.rejects(
    () => narrower.write("/notes/x.md", { type: "text", text: "x" }, meta, prov),
    ResourceAccessError,
  );
  await assert.rejects(
    () => narrower.write("/research/x.md", { type: "text", text: "x" }, meta, prov),
    ResourceAccessError,
  );
});

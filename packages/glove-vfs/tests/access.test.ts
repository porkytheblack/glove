import { test } from "node:test";
import assert from "node:assert/strict";

import {
  accessFor,
  hasMeta,
  hasSearch,
  inMemoryFs,
  toBytes,
  toText,
  withAccess,
  withMeta,
  type MetaVfs,
  type SearchVfs,
  type Vfs,
} from "../src/index";

async function seeded(): Promise<Vfs> {
  const fs = inMemoryFs();
  await fs.write("/corpus/paper.txt", toBytes("published"));
  await fs.write("/work/draft.md", toBytes("mine"));
  await fs.write("/secrets/key.txt", toBytes("shhh"));
  await fs.write("/work/notes.locked.md", toBytes("frozen"));
  return fs;
}

test("rules cascade last-match-wins over the default", () => {
  const policy = {
    default: "none" as const,
    rules: [
      { path: "/work", access: "write" as const },
      { path: "/**/*.locked.md", access: "read" as const },
    ],
  };
  assert.equal(accessFor(policy, "/work/draft.md"), "write");
  assert.equal(accessFor(policy, "/work/notes.locked.md"), "read");
  assert.equal(accessFor(policy, "/secrets/key.txt"), "none");
});

test("read-only refuses mutation and permits reads", async () => {
  const fs = withAccess(await seeded(), {
    rules: [{ path: "/corpus", access: "read", note: "curated upstream" }],
  });

  assert.equal(toText(await fs.read("/corpus/paper.txt")), "published");
  await assert.rejects(() => fs.write("/corpus/paper.txt", toBytes("x")), /read-only.*curated upstream/s);
  await assert.rejects(() => fs.rm("/corpus/paper.txt"), /read-only/);
  await fs.write("/work/draft.md", toBytes("edited"));
});

test("a hidden path is filtered from listings but refused when named", async () => {
  const fs = withAccess(await seeded(), { rules: [{ path: "/secrets", access: "none" }] });

  assert.deepEqual(
    (await fs.list("/")).map((e) => e.name),
    ["corpus", "work"],
  );
  assert.ok(!(await fs.files()).some((f) => f.startsWith("/secrets")));
  // Guessing the name must not be a probe that succeeds.
  await assert.rejects(() => fs.read("/secrets/key.txt"), /not readable/);
  // …and must not throw where the question is "may I look".
  assert.equal(await fs.exists("/secrets/key.txt"), false);
  assert.equal(await fs.stat("/secrets/key.txt"), null);
});

test("an allowlist stays navigable down to what it grants", async () => {
  const fs = withAccess(await seeded(), {
    default: "none",
    rules: [{ path: "/work", access: "read" }],
  });

  assert.deepEqual(
    (await fs.list("/")).map((e) => e.name),
    ["work"],
  );
  assert.equal(toText(await fs.read("/work/draft.md")), "mine");
  await assert.rejects(() => fs.read("/corpus/paper.txt"), /not readable/);
});

test("a recursive remove that would reach a protected path is refused whole", async () => {
  const inner = await seeded();
  const fs = withAccess(inner, {
    rules: [{ path: "/work/notes.locked.md", access: "read" }],
  });

  await assert.rejects(() => fs.rm("/work"), /notes\.locked\.md.*read-only/s);
  // Nothing was half-deleted.
  assert.equal(await inner.exists("/work/draft.md"), true);
});

test("totalSize reports the whole tree, so hiding a subtree cannot buy budget", async () => {
  const inner = await seeded();
  const fs = withAccess(inner, { rules: [{ path: "/secrets", access: "none" }] });
  assert.equal(await fs.totalSize(), await inner.totalSize());
});

// Both of these were silent losses found by running the documented composition
// rather than reading it. `withAccess` wraps `withMeta` in every example we
// ship, so a guard that implements only the nine base methods quietly turns a
// metadata-bearing tree into a plain one: the memory adapter reads back empty
// metadata, `fsFns` stops emitting `fs__meta`/`fs__search`, and nothing errors.
test("a policy forwards the metadata capability instead of erasing it", async () => {
  const fs = withAccess(withMeta(inMemoryFs(), { lexical: true }), {
    rules: [{ path: "/corpus", access: "read", note: "curated upstream" }],
  });

  assert.equal(hasMeta(fs), true, "hasMeta must survive the guard");
  assert.equal(hasSearch(fs), true, "hasSearch must survive the guard");

  await fs.write("/work/note.md", toBytes("Revenue is up."));
  await (fs as MetaVfs).setMeta("/work/note.md", { summary: "the finding", tags: ["q3"] });
  assert.equal((await (fs as MetaVfs).getMeta("/work/note.md"))?.metadata.summary, "the finding");
});

test("the policy governs the metadata surface rather than being bypassed by it", async () => {
  const base = withMeta(inMemoryFs(), { lexical: true });
  await base.write("/corpus/secret.md", toBytes("acquisition talks with Initech"));
  await base.setMeta("/corpus/secret.md", { summary: "the deal", links: [{ kind: "entity", id: "e1" }] });
  await base.write("/work/ok.md", toBytes("acquisition of paper clips"));
  await base.setMeta("/work/ok.md", { summary: "mine", links: [{ kind: "entity", id: "e1" }] });

  const fs = withAccess(base, { rules: [{ path: "/corpus", access: "none" }] }) as MetaVfs & SearchVfs;

  // A summary describes bytes you may not read, so it is refused like a read.
  await assert.rejects(() => fs.getMeta("/corpus/secret.md"), /access policy/);
  // A write to a fenced path is refused whichever door it comes through.
  await assert.rejects(() => fs.setMeta("/corpus/secret.md", { summary: "nope" }), /access policy/);
  await assert.rejects(() => fs.setEmbedding("/corpus/secret.md", [0.1]), /access policy/);
  // A hit is an existence proof, so searches and link lookups filter.
  assert.deepEqual((await fs.linksFor("entity", "e1")).map((l) => l.path), ["/work/ok.md"]);
  assert.deepEqual((await fs.searchSemantic("acquisition")).map((m) => m.path), ["/work/ok.md"]);
  assert.ok(!(await fs.findNeedingEmbedding()).includes("/corpus/secret.md"));
  // Refused whole rather than partially applied, like a recursive rm.
  await assert.rejects(() => fs.replaceLinkTarget("entity", "e1", "e2"), /access policy/);
  assert.equal((await base.getMeta("/work/ok.md"))?.metadata.links[0].id, "e1", "nothing was rewritten");
});

test("a plain guarded tree still advertises no capabilities it lacks", async () => {
  const fs = withAccess(inMemoryFs(), { rules: [] });
  assert.equal(hasMeta(fs), false);
  assert.equal(hasSearch(fs), false);
});

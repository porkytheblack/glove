import { test } from "node:test";
import assert from "node:assert/strict";

import { accessFor, inMemoryFs, toBytes, toText, withAccess, type Vfs } from "../src/index";

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
